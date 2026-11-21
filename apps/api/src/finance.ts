import { Router, type Request, type RequestHandler } from "express";
import rateLimit from "express-rate-limit";
import {
  PaymentMethod,
  PersonRole,
  Prisma,
  PrismaClient,
  ScopeType,
} from "@prisma/client";
import crypto from "node:crypto";
import { z } from "zod";
import {
  calculateChargeTotals,
  canAuthorizeSeparately,
  expectedCashForDay,
  formatReceiptNumber,
} from "./finance-rules";

type AuthContext = {
  sub: string;
  personId: string;
  roles: { code: PersonRole; scopeType: ScopeType; scopeId?: string | null }[];
};

type FinanceDependencies = {
  prisma: PrismaClient;
  authenticate: RequestHandler;
  requireRole: (...codes: PersonRole[]) => RequestHandler;
  currentAuth: (req: Request) => AuthContext;
  writeAudit: (data: {
    userId?: string;
    action: string;
    entityType: string;
    entityId?: string;
    oldValue?: unknown;
    newValue?: unknown;
    reason?: string;
    req?: Request;
  }) => Promise<void>;
};

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, "Date invalide").transform((value) => new Date(`${value}T00:00:00.000Z`));

const amount = z.number().int().positive().max(1_000_000_000);
const paymentMethod = z.nativeEnum(PaymentMethod);

function isFinanceRole(auth: AuthContext, role: PersonRole) {
  return auth.roles.some((assignment) =>
    assignment.code === role && assignment.scopeType === ScopeType.ETABLISSEMENT,
  );
}

function apiError(message: string, status = 409) {
  return Object.assign(new Error(message), { status });
}

export function createFinanceRouter(deps: FinanceDependencies) {
  const { prisma, authenticate, requireRole, currentAuth, writeAudit } = deps;
  const router = Router();
  const receiptVerifyLimit = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 8,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Trop de vérifications. Réessayez plus tard." },
  });
  const financeAccess: RequestHandler[] = [
    requireRole(PersonRole.ECO, PersonRole.DIR),
    (req, res, next) => {
      const auth = currentAuth(req);
      const financeRoles: PersonRole[] = [PersonRole.ECO, PersonRole.DIR];
      if (!auth.roles.some((role) =>
        financeRoles.includes(role.code) && role.scopeType === ScopeType.ETABLISSEMENT,
      )) return res.status(403).json({ error: "Accès financier réservé à l'économe ou à la direction" });
      next();
    },
  ];

  async function studentCharges(studentId: string, yearId?: string) {
    const charges = await prisma.studentCharge.findMany({
      where: { studentId, ...(yearId ? { yearId } : {}) },
      include: {
        year: true,
        feeSchedule: { include: { feeType: true, level: true } },
        discounts: true,
        installments: { orderBy: { sequence: "asc" } },
        allocations: { include: { payment: { include: { reversal: true } } } },
      },
      orderBy: [{ dueDate: "asc" }, { createdAt: "asc" }],
    });
    return charges.map((charge) => ({
      ...charge,
      totals: calculateChargeTotals(
        charge.amount,
        charge.discounts.map((discount) => discount.amount),
        charge.allocations.map((allocation) => ({
          amount: allocation.amount,
          reversed: allocation.payment.reversal !== null,
        })),
      ),
    }));
  }

  router.get("/finance/receipt-verify/:token", receiptVerifyLimit, async (req, res) => {
    const payment = await prisma.schoolPayment.findUnique({
      where: { qrToken: String(req.params.token) },
      include: { reversal: true },
    });
    if (!payment) return res.status(200).json({ valid: false, status: "INTROUVABLE" });
    res.setHeader("Cache-Control", "no-store");
    res.json({
      valid: payment.reversal === null,
      receiptNumber: payment.receiptNumber,
      status: payment.reversal ? "ANNULE" : "VALIDE",
    });
  });

  router.get("/finance/levels", authenticate, ...financeAccess, async (_req, res) => {
    res.json(await prisma.level.findMany({
      include: { cycle: true, pathways: true },
      orderBy: [{ cycle: { code: "asc" } }, { order: "asc" }],
    }));
  });

  router.get("/finance/students", authenticate, ...financeAccess, async (req, res) => {
    const search = String(req.query.search ?? "").trim();
    const students = await prisma.student.findMany({
      where: {
        status: "ACTIF",
        enrollments: { some: { status: "ACTIVE" } },
        ...(search ? {
          OR: [
            { matricule: { contains: search, mode: "insensitive" } },
            { person: { nom: { contains: search, mode: "insensitive" } } },
            { person: { prenoms: { contains: search, mode: "insensitive" } } },
          ],
        } : {}),
      },
      include: {
        person: true,
        enrollments: {
          where: { status: "ACTIVE" },
          include: { class: { include: { pathway: { include: { level: true } } } }, year: true },
        },
      },
      orderBy: { person: { nom: "asc" } },
      take: 200,
    });
    res.json(students);
  });

  router.get("/finance/fee-types", authenticate, ...financeAccess, async (_req, res) => {
    res.json(await prisma.feeType.findMany({ where: { active: true }, orderBy: { label: "asc" } }));
  });

  router.post("/finance/fee-types", authenticate, ...financeAccess, async (req, res) => {
    if (!isFinanceRole(currentAuth(req), PersonRole.DIR) && !isFinanceRole(currentAuth(req), PersonRole.ECO)) {
      return res.status(403).json({ error: "Accès refusé" });
    }
    const parsed = z.object({
      code: z.string().trim().min(2).max(40).regex(/^[A-Z0-9_-]+$/),
      label: z.string().trim().min(2).max(120),
    }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: z.prettifyError(parsed.error) });
    if (await prisma.feeType.findUnique({ where: { code: parsed.data.code } })) {
      return res.status(409).json({ error: "Ce code de frais existe déjà" });
    }
    const feeType = await prisma.feeType.create({ data: parsed.data });
    await writeAudit({ userId: currentAuth(req).sub, action: "FEE_TYPE_CREATE", entityType: "FEE_TYPE", entityId: feeType.id, newValue: feeType, req });
    res.status(201).json(feeType);
  });

  router.get("/finance/schedules", authenticate, ...financeAccess, async (req, res) => {
    const yearId = String(req.query.yearId ?? "");
    res.json(await prisma.feeSchedule.findMany({
      where: { ...(yearId ? { yearId } : {}) },
      include: { feeType: true, year: true, level: { include: { cycle: true } } },
      orderBy: [{ year: { dateStart: "desc" } }, { level: { order: "asc" } }, { feeType: { label: "asc" } }],
    }));
  });

  router.post("/finance/schedules", authenticate, ...financeAccess, async (req, res) => {
    const auth = currentAuth(req);
    const parsed = z.object({
      feeTypeId: z.string().uuid(),
      yearId: z.string().uuid(),
      levelId: z.string().uuid(),
      amount,
      dueDate: dateOnly.nullable().optional(),
    }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: z.prettifyError(parsed.error) });
    const [feeType, year, level] = await Promise.all([
      prisma.feeType.findFirst({ where: { id: parsed.data.feeTypeId, active: true } }),
      prisma.academicYear.findUnique({ where: { id: parsed.data.yearId } }),
      prisma.level.findUnique({ where: { id: parsed.data.levelId } }),
    ]);
    if (!feeType || !year || !level) return res.status(400).json({ error: "Type de frais, année ou niveau introuvable" });
    if (parsed.data.dueDate && (parsed.data.dueDate < year.dateStart || parsed.data.dueDate > year.dateEnd)) {
      return res.status(400).json({ error: "L'échéance doit être comprise dans l'année scolaire" });
    }
    const duplicate = await prisma.feeSchedule.findUnique({
      where: { feeTypeId_yearId_levelId: { feeTypeId: feeType.id, yearId: year.id, levelId: level.id } },
    });
    if (duplicate) return res.status(409).json({ error: "Un tarif existe déjà pour ce type, cette année et ce niveau" });
    const schedule = await prisma.feeSchedule.create({
      data: { ...parsed.data, dueDate: parsed.data.dueDate ?? null, createdBy: auth.sub },
      include: { feeType: true, year: true, level: true },
    });
    await writeAudit({ userId: auth.sub, action: "FEE_SCHEDULE_CREATE", entityType: "FEE_SCHEDULE", entityId: schedule.id, newValue: schedule, req });
    res.status(201).json(schedule);
  });

  router.post("/finance/charges/assign", authenticate, ...financeAccess, async (req, res) => {
    const auth = currentAuth(req);
    const parsed = z.object({
      feeScheduleId: z.string().uuid(),
      studentIds: z.array(z.string().uuid()).min(1).max(500),
    }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: z.prettifyError(parsed.error) });
    if (new Set(parsed.data.studentIds).size !== parsed.data.studentIds.length) {
      return res.status(400).json({ error: "Un élève apparaît plusieurs fois" });
    }
    const schedule = await prisma.feeSchedule.findFirst({
      where: { id: parsed.data.feeScheduleId, active: true },
      include: { year: true },
    });
    if (!schedule) return res.status(404).json({ error: "Tarif actif introuvable" });
    const enrollments = await prisma.enrollment.findMany({
      where: {
        studentId: { in: parsed.data.studentIds },
        yearId: schedule.yearId,
        status: "ACTIVE",
        class: { pathway: { levelId: schedule.levelId } },
      },
      select: { studentId: true, classId: true },
    });
    if (enrollments.length !== parsed.data.studentIds.length) {
      return res.status(400).json({ error: "Chaque élève doit être inscrit à un niveau correspondant pour cette année" });
    }
    try {
      const charges = await prisma.$transaction(async (tx) => {
        const existing = await tx.studentCharge.findMany({
          where: { feeScheduleId: schedule.id, studentId: { in: parsed.data.studentIds } },
          select: { studentId: true },
        });
        if (existing.length) throw apiError("Des frais ont déjà été affectés à un ou plusieurs élèves");
        const classByStudent = new Map(enrollments.map((enrollment) => [enrollment.studentId, enrollment.classId]));
        await tx.studentCharge.createMany({
          data: parsed.data.studentIds.map((studentId) => ({
            studentId,
            yearId: schedule.yearId,
            feeScheduleId: schedule.id,
            amount: schedule.amount,
            dueDate: schedule.dueDate,
            schoolClassId: classByStudent.get(studentId),
            createdBy: auth.sub,
          })),
        });
        return tx.studentCharge.findMany({
          where: { feeScheduleId: schedule.id, studentId: { in: parsed.data.studentIds } },
          include: { student: { include: { person: true } } },
          orderBy: { student: { person: { nom: "asc" } } },
        });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      await writeAudit({ userId: auth.sub, action: "STUDENT_CHARGES_ASSIGN", entityType: "FEE_SCHEDULE", entityId: schedule.id, newValue: { count: charges.length }, req });
      res.status(201).json({ assigned: charges.length, charges });
    } catch (error) {
      if (error instanceof Error && "status" in error) {
        return res.status(Number(error.status)).json({ error: error.message });
      }
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
        return res.status(409).json({ error: "L'affectation a été modifiée simultanément. Réessayez." });
      }
      throw error;
    }
  });

  router.get("/finance/balances", authenticate, ...financeAccess, async (req, res) => {
    const search = String(req.query.search ?? "").trim();
    const yearId = String(req.query.yearId ?? "");
    const charges = await prisma.studentCharge.findMany({
      where: {
        ...(yearId ? { yearId } : {}),
        student: search ? {
          OR: [
            { matricule: { contains: search, mode: "insensitive" } },
            { person: { nom: { contains: search, mode: "insensitive" } } },
            { person: { prenoms: { contains: search, mode: "insensitive" } } },
          ],
        } : undefined,
      },
      include: {
        student: { include: { person: true } },
        year: true,
        feeSchedule: { include: { feeType: true, level: true } },
        discounts: true,
        allocations: { include: { payment: { include: { reversal: true } } } },
      },
      orderBy: [{ student: { person: { nom: "asc" } } }, { dueDate: "asc" }],
      take: 2000,
    });
    const balances = new Map<string, {
      studentId: string;
      student: typeof charges[number]["student"];
      charges: unknown[];
      totalBalance: number;
    }>();
    for (const charge of charges) {
      const totals = calculateChargeTotals(
        charge.amount,
        charge.discounts.map((discount) => discount.amount),
        charge.allocations.map((allocation) => ({
          amount: allocation.amount,
          reversed: allocation.payment.reversal !== null,
        })),
      );
      const row = balances.get(charge.studentId) ?? {
        studentId: charge.studentId,
        student: charge.student,
        charges: [],
        totalBalance: 0,
      };
      row.charges.push({
        id: charge.id,
        year: charge.year.label,
        feeType: charge.feeSchedule.feeType.label,
        level: charge.feeSchedule.level.label,
        amount: charge.amount,
        dueDate: charge.dueDate,
        totals,
      });
      row.totalBalance += totals.balance;
      balances.set(charge.studentId, row);
    }
    res.json([...balances.values()].filter((row) => row.totalBalance > 0));
  });

  router.get("/finance/students/:studentId/balance", authenticate, ...financeAccess, async (req, res) => {
    const studentId = String(req.params.studentId);
    const [student, charges, payments] = await Promise.all([
      prisma.student.findUnique({ where: { id: studentId }, include: { person: true } }),
      studentCharges(studentId),
      prisma.schoolPayment.findMany({
        where: { studentId },
        include: {
          reversal: true,
          allocations: { include: { charge: { include: { feeSchedule: { include: { feeType: true } } } } } },
        },
        orderBy: { paidAt: "desc" },
      }),
    ]);
    if (!student) return res.status(404).json({ error: "Élève introuvable" });
    res.json({
      student,
      charges,
      payments,
      totalBalance: charges.reduce((sum, charge) => sum + charge.totals.balance, 0),
    });
  });

  router.get("/finance/charges/:id", authenticate, ...financeAccess, async (req, res) => {
    const charge = await prisma.studentCharge.findUnique({ where: { id: String(req.params.id) } });
    if (!charge) return res.status(404).json({ error: "Frais affecté introuvable" });
    const [fullCharge, history] = await Promise.all([
      studentCharges(charge.studentId, charge.yearId),
      prisma.schoolPayment.findMany({
        where: { allocations: { some: { chargeId: charge.id } } },
        include: { reversal: true, allocations: { where: { chargeId: charge.id } } },
        orderBy: { paidAt: "desc" },
      }),
    ]);
    res.json({
      charge: fullCharge.find((item) => item.id === charge.id),
      payments: history,
    });
  });

  router.post("/finance/charges/:id/discount", authenticate, ...financeAccess, async (req, res) => {
    const auth = currentAuth(req);
    if (!isFinanceRole(auth, PersonRole.DIR)) return res.status(403).json({ error: "Seule la direction peut autoriser une remise" });
    const parsed = z.object({
      amount,
      reason: z.string().trim().min(5).max(1000),
    }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: z.prettifyError(parsed.error) });
    try {
      const discount = await prisma.$transaction(async (tx) => {
        const charge = await tx.studentCharge.findUnique({
          where: { id: String(req.params.id) },
          include: {
            discounts: true,
            allocations: { include: { payment: { include: { reversal: true } } } },
          },
        });
        if (!charge) throw apiError("Frais affecté introuvable", 404);
        if (charge.allocations.some((allocation) =>
          !canAuthorizeSeparately(allocation.payment.receivedBy, auth.sub),
        )) throw apiError("La direction ne peut pas autoriser une remise sur un paiement qu'elle-même a encaissé", 403);
        const totals = calculateChargeTotals(
          charge.amount,
          charge.discounts.map((item) => item.amount),
          charge.allocations.map((item) => ({
            amount: item.amount,
            reversed: item.payment.reversal !== null,
          })),
        );
        if (parsed.data.amount > totals.balance) throw apiError("La remise dépasse le solde restant");
        return tx.feeDiscount.create({
          data: { chargeId: charge.id, amount: parsed.data.amount, reason: parsed.data.reason, authorizedBy: auth.sub },
        });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      await writeAudit({ userId: auth.sub, action: "FEE_DISCOUNT_AUTHORIZE", entityType: "FEE_DISCOUNT", entityId: discount.id, newValue: discount, reason: parsed.data.reason, req });
      res.status(201).json(discount);
    } catch (error) {
      if (error instanceof Error && "status" in error) {
        return res.status(Number(error.status)).json({ error: error.message });
      }
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
        return res.status(409).json({ error: "Le solde a changé simultanément. Recalculez puis réessayez." });
      }
      throw error;
    }
  });

  router.post("/finance/charges/:id/installments", authenticate, ...financeAccess, async (req, res) => {
    const auth = currentAuth(req);
    const parsed = z.object({
      installments: z.array(z.object({ dueDate: dateOnly, amount })).min(1).max(24),
    }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: z.prettifyError(parsed.error) });
    const charge = await prisma.studentCharge.findUnique({
      where: { id: String(req.params.id) },
      include: {
        year: true,
        discounts: true,
        allocations: true,
        installments: true,
      },
    });
    if (!charge) return res.status(404).json({ error: "Frais affecté introuvable" });
    if (charge.installments.length || charge.allocations.length) return res.status(409).json({ error: "L'échéancier ne peut être fixé qu'une seule fois avant le premier encaissement" });
    const total = parsed.data.installments.reduce((sum, item) => sum + item.amount, 0);
    const balance = calculateChargeTotals(charge.amount, charge.discounts.map((item) => item.amount), []).balance;
    if (total !== balance) return res.status(400).json({ error: "La somme des échéances doit être égale au solde du frais" });
    if (parsed.data.installments.some((item, index, entries) =>
      item.dueDate < charge.year.dateStart || item.dueDate > charge.year.dateEnd ||
      (index > 0 && item.dueDate < entries[index - 1].dueDate),
    )) return res.status(400).json({ error: "Les échéances doivent être ordonnées et comprises dans l'année scolaire" });
    const installments = await prisma.feeInstallment.createManyAndReturn({
      data: parsed.data.installments.map((item, index) => ({
        chargeId: charge.id,
        sequence: index + 1,
        dueDate: item.dueDate,
        amount: item.amount,
        createdBy: auth.sub,
      })),
    });
    await writeAudit({ userId: auth.sub, action: "FEE_INSTALLMENT_PLAN_CREATE", entityType: "STUDENT_CHARGE", entityId: charge.id, newValue: installments, req });
    res.status(201).json(installments);
  });

  router.post("/finance/payments", authenticate, requireRole(PersonRole.ECO), ...financeAccess, async (req, res) => {
    const auth = currentAuth(req);
    const parsed = z.object({
      studentId: z.string().uuid(),
      method: paymentMethod,
      amount,
      transactionRef: z.string().trim().max(200).optional(),
      allocations: z.array(z.object({ chargeId: z.string().uuid(), amount })).min(1).max(50),
    }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: z.prettifyError(parsed.error) });
    if (new Set(parsed.data.allocations.map((item) => item.chargeId)).size !== parsed.data.allocations.length) {
      return res.status(400).json({ error: "Un frais apparaît plusieurs fois dans la répartition" });
    }
    if (parsed.data.allocations.reduce((sum, item) => sum + item.amount, 0) !== parsed.data.amount) {
      return res.status(400).json({ error: "Le total réparti doit correspondre au montant encaissé" });
    }
    try {
      const payment = await prisma.$transaction(async (tx) => {
        const chargeIds = parsed.data.allocations.map((item) => item.chargeId);
        const charges = await tx.studentCharge.findMany({
          where: { id: { in: chargeIds }, studentId: parsed.data.studentId },
          include: {
            discounts: true,
            allocations: { include: { payment: { include: { reversal: true } } } },
          },
        });
        if (charges.length !== chargeIds.length) throw apiError("Chaque frais doit appartenir à l'élève sélectionné", 400);
        const chargeById = new Map(charges.map((charge) => [charge.id, charge]));
        for (const allocation of parsed.data.allocations) {
          const charge = chargeById.get(allocation.chargeId)!;
          const totals = calculateChargeTotals(
            charge.amount,
            charge.discounts.map((discount) => discount.amount),
            charge.allocations.map((item) => ({
              amount: item.amount,
              reversed: item.payment.reversal !== null,
            })),
          );
          if (allocation.amount > totals.balance) {
            throw apiError(`Le paiement dépasse le solde dû pour « ${charge.id} »`);
          }
        }
        const counter = await tx.receiptCounter.upsert({
          where: { id: "global" },
          create: { id: "global", lastNumber: 1 },
          update: { lastNumber: { increment: 1 } },
        });
        const paymentClassId = charges[0]?.schoolClassId ?? null;
        const sharesOneClass = paymentClassId !== null && charges.every((charge) => charge.schoolClassId === paymentClassId);
        return tx.schoolPayment.create({
          data: {
            studentId: parsed.data.studentId,
            schoolClassId: sharesOneClass ? paymentClassId : null,
            receiptNumber: formatReceiptNumber(counter.lastNumber),
            qrToken: crypto.randomBytes(24).toString("base64url"),
            amount: parsed.data.amount,
            method: parsed.data.method,
            transactionRef: parsed.data.transactionRef,
            receivedBy: auth.sub,
            allocations: { create: parsed.data.allocations },
          },
          include: { student: { include: { person: true } }, allocations: true },
        });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      await writeAudit({ userId: auth.sub, action: "PAYMENT_RECEIVE", entityType: "SCHOOL_PAYMENT", entityId: payment.id, newValue: { receiptNumber: payment.receiptNumber, amount: payment.amount, method: payment.method }, req });
      res.status(201).json(payment);
    } catch (error) {
      if (error instanceof Error && "status" in error) {
        return res.status(Number(error.status)).json({ error: error.message });
      }
      if (error instanceof Prisma.PrismaClientKnownRequestError && (error.code === "P2034" || error.code === "P2002")) {
        return res.status(409).json({ error: "Le journal a changé simultanément. Vérifiez le solde et réessayez." });
      }
      throw error;
    }
  });

  router.get("/finance/payments", authenticate, ...financeAccess, async (req, res) => {
    const studentId = String(req.query.studentId ?? "");
    if (!studentId) return res.status(400).json({ error: "L'élève est requis" });
    res.json(await prisma.schoolPayment.findMany({
      where: { studentId },
      include: {
        reversal: true,
        allocations: { include: { charge: { include: { feeSchedule: { include: { feeType: true } } } } } },
      },
      orderBy: { paidAt: "desc" },
      take: 200,
    }));
  });

  router.get("/finance/receipt/:receiptNumber", authenticate, ...financeAccess, async (req, res) => {
    const payment = await prisma.schoolPayment.findUnique({
      where: { receiptNumber: String(req.params.receiptNumber) },
      include: { student: { include: { person: true } }, allocations: true, reversal: true },
    });
    if (!payment) return res.status(404).json({ error: "Reçu introuvable" });
    res.json(payment);
  });

  router.post("/finance/payments/:id/reversal", authenticate, ...financeAccess, async (req, res) => {
    const auth = currentAuth(req);
    if (!isFinanceRole(auth, PersonRole.DIR)) return res.status(403).json({ error: "Seule la direction peut autoriser une annulation" });
    const parsed = z.object({
      reason: z.string().trim().min(5).max(1000),
      refundMethod: paymentMethod,
    }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: z.prettifyError(parsed.error) });
    const payment = await prisma.schoolPayment.findUnique({
      where: { id: String(req.params.id) },
      include: { reversal: true },
    });
    if (!payment) return res.status(404).json({ error: "Paiement introuvable" });
    if (!canAuthorizeSeparately(payment.receivedBy, auth.sub)) {
      return res.status(403).json({ error: "La personne qui a encaissé ne peut pas autoriser l'annulation" });
    }
    if (payment.reversal) return res.status(409).json({ error: "Ce paiement est déjà annulé" });
    const reversal = await prisma.paymentReversal.create({
      data: {
        paymentId: payment.id,
        amount: payment.amount,
        refundMethod: parsed.data.refundMethod,
        reason: parsed.data.reason,
        authorizedBy: auth.sub,
      },
    });
    await writeAudit({ userId: auth.sub, action: "PAYMENT_REVERSAL_AUTHORIZE", entityType: "PAYMENT_REVERSAL", entityId: reversal.id, oldValue: payment.id, newValue: reversal, reason: parsed.data.reason, req });
    res.status(201).json(reversal);
  });

  router.get("/finance/cash-closures", authenticate, ...financeAccess, async (req, res) => {
    const parsed = z.object({ date: dateOnly.optional() }).safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: z.prettifyError(parsed.error) });
    res.json(await prisma.cashClosure.findMany({
      where: {
        ...(parsed.data.date ? { date: parsed.data.date } : {}),
        ...(isFinanceRole(currentAuth(req), PersonRole.ECO) ? { cashierId: currentAuth(req).sub } : {}),
      },
      orderBy: { date: "desc" },
      take: 90,
    }));
  });

  router.post("/finance/cash-closures", authenticate, requireRole(PersonRole.ECO), ...financeAccess, async (req, res) => {
    const auth = currentAuth(req);
    const parsed = z.object({ date: dateOnly, countedCash: z.number().int().min(0).max(1_000_000_000) }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: z.prettifyError(parsed.error) });
    const nextDay = new Date(parsed.data.date);
    nextDay.setUTCDate(nextDay.getUTCDate() + 1);
    const [receipts, refunds, existing] = await Promise.all([
      prisma.schoolPayment.findMany({
        where: { method: PaymentMethod.ESPECES, paidAt: { gte: parsed.data.date, lt: nextDay } },
        select: { amount: true },
      }),
      prisma.paymentReversal.findMany({
        where: { refundMethod: PaymentMethod.ESPECES, createdAt: { gte: parsed.data.date, lt: nextDay } },
        select: { amount: true },
      }),
      prisma.cashClosure.findUnique({ where: { cashierId_date: { cashierId: auth.sub, date: parsed.data.date } } }),
    ]);
    if (existing) return res.status(409).json({ error: "Cette caisse a déjà été clôturée pour la journée" });
    const expectedCash = expectedCashForDay(receipts.map((item) => item.amount), refunds.map((item) => item.amount));
    const closure = await prisma.cashClosure.create({
      data: {
        cashierId: auth.sub,
        date: parsed.data.date,
        expectedCash,
        countedCash: parsed.data.countedCash,
        difference: parsed.data.countedCash - expectedCash,
      },
    });
    await writeAudit({ userId: auth.sub, action: "CASH_CLOSURE_CREATE", entityType: "CASH_CLOSURE", entityId: closure.id, newValue: closure, req });
    res.status(201).json(closure);
  });

  return router;
}
