import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "node:crypto";
import multer from "multer";
import * as XLSX from "xlsx";
import { PrismaClient, PersonRole, ScopeType } from "@prisma/client";
import { z } from "zod";
import { assertDateRange, buildMatricule, validateMark } from "./rules";
import {
  assignCompetitionRanks,
  calculateSubjectAverages,
  calculateWeightedAverage,
} from "./grading";
import { createJ3Router } from "./j3";
import { createFinanceRouter } from "./finance";
import { createWorkloadRouter } from "./workload";
import { createSiteRouter } from "./site";
import { decryptTotpSecret, encryptTotpSecret, generateTotpSecret, verifyTotp } from "./auth-rules";

const app = express();
const prisma = new PrismaClient();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

app.use(helmet());
app.use(cors({ origin: process.env.WEB_ORIGIN ?? "http://localhost:5173" }));
app.use(express.json({ limit: "2mb" }));
app.use("/api/auth", rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Trop de tentatives. Réessayez dans quelques minutes." },
}));

const jwtSecret = (() => {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET doit être configuré dans l'environnement");
  return secret;
})();
const totpEncryptionKey = crypto.createHash("sha256").update(`school-totp-encryption-v1:${jwtSecret}`).digest();

type JwtPayload = {
  sub: string;
  personId: string;
  roles: { code: PersonRole; scopeType: ScopeType; scopeId?: string | null }[];
};

async function writeAudit(data: {
  userId?: string;
  action: string;
  entityType: string;
  entityId?: string;
  oldValue?: unknown;
  newValue?: unknown;
  reason?: string;
  req?: express.Request;
}) {
  const previous = await prisma.auditLog.findFirst({ orderBy: { createdAt: "desc" } });
  const payload = JSON.stringify({
    userId: data.userId,
    action: data.action,
    entityType: data.entityType,
    entityId: data.entityId,
    oldValue: data.oldValue,
    newValue: data.newValue,
    reason: data.reason,
  });
  const fingerprint = crypto.createHash("sha256").update((previous?.fingerprint ?? "") + payload).digest("hex");
  await prisma.auditLog.create({
    data: {
      userId: data.userId,
      action: data.action,
      entityType: data.entityType,
      entityId: data.entityId,
      oldValue: data.oldValue as any,
      newValue: data.newValue as any,
      reason: data.reason,
      ip: data.req?.ip,
      userAgent: data.req?.headers["user-agent"],
      previousFingerprint: previous?.fingerprint,
      fingerprint,
    },
  });
}

async function authenticate(req: express.Request, res: express.Response, next: express.NextFunction) {
  const authorization = req.headers.authorization;
  if (!authorization?.startsWith("Bearer ")) return res.status(401).json({ error: "Authentification requise" });
  try {
    const decoded = jwt.verify(authorization.slice(7), jwtSecret);
    const parsedPayload = z.object({
      sub: z.string(),
      personId: z.string(),
      roles: z.array(z.object({
        code: z.nativeEnum(PersonRole),
        scopeType: z.nativeEnum(ScopeType),
        scopeId: z.string().nullable().optional(),
      })),
    }).safeParse(decoded);
    if (!parsedPayload.success) return res.status(401).json({ error: "Session invalide ou expirée" });
    const payload = parsedPayload.data;
    const now = new Date();
    const user = await prisma.user.findFirst({
      where: { id: payload.sub, active: true },
      include: {
        roles: {
          where: {
            dateStart: { lte: now },
            OR: [{ dateEnd: null }, { dateEnd: { gte: now } }],
          },
          include: { role: true },
        },
      },
    });
    if (!user) return res.status(401).json({ error: "Session invalide ou expirée" });
    (req as any).auth = {
      sub: user.id,
      personId: user.personId,
      roles: user.roles.map((assignment) => ({
        code: assignment.role.code,
        scopeType: assignment.scopeType,
        scopeId: assignment.scopeId,
      })),
    } satisfies JwtPayload;
    next();
  } catch {
    res.status(401).json({ error: "Session invalide ou expirée" });
  }
}

function requireRole(...codes: PersonRole[]) {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const auth = (req as any).auth as JwtPayload | undefined;
    if (!auth?.roles.some((role) => codes.includes(role.code))) {
      return res.status(403).json({ error: "Accès refusé" });
    }
    next();
  };
}

function currentAuth(req: express.Request) {
  return (req as any).auth as JwtPayload;
}

async function classCycleId(classId: string) {
  const schoolClass = await prisma.schoolClass.findUnique({
    where: { id: classId },
    include: { pathway: { include: { level: true } } },
  });
  return schoolClass?.pathway.level.cycleId ?? null;
}

async function canAccessClass(auth: JwtPayload, classId: string) {
  const cycleId = await classCycleId(classId);
  if (!cycleId) return false;
  const withinRoleScope = auth.roles.some((role) =>
    role.scopeType === ScopeType.ETABLISSEMENT ||
    (role.scopeType === ScopeType.CYCLE && role.scopeId === cycleId) ||
    (role.scopeType === ScopeType.CLASSE && role.scopeId === classId),
  );
  if (!withinRoleScope) return false;
  const restrictedRoles: PersonRole[] = [PersonRole.PROF, PersonRole.TIT];
  if (auth.roles.some((role) => restrictedRoles.includes(role.code))) {
    return (await accessibleClassIds(auth)).includes(classId);
  }
  return true;
}

async function accessibleClassIds(auth: JwtPayload) {
  const now = new Date();
  const userRoles = auth.roles.map((role) => role.code);
  if ([PersonRole.ELE, PersonRole.PAR, PersonRole.ADM].some((code) => userRoles.includes(code))) return [] as string[];
  const classes = await prisma.schoolClass.findMany({
    select: { id: true, pathway: { select: { level: { select: { cycleId: true } } } } },
  });
  const scoped = classes.filter((item) => auth.roles.some((role) =>
    role.scopeType === ScopeType.ETABLISSEMENT ||
    (role.scopeType === ScopeType.CYCLE && role.scopeId === item.pathway.level.cycleId) ||
    (role.scopeType === ScopeType.CLASSE && role.scopeId === item.id),
  ));
  const teachingRoles: PersonRole[] = [PersonRole.PROF, PersonRole.TIT];
  const restrictedRoles = userRoles.some((code) => teachingRoles.includes(code));
  if (!restrictedRoles) return scoped.map((item) => item.id);

  const teacher = await prisma.teacher.findUnique({ where: { personId: auth.personId } });
  if (!teacher) return [];
  const classIds = new Set<string>();
  if (userRoles.includes(PersonRole.PROF)) {
    const assignments = await prisma.teachingAssignment.findMany({
      where: {
        teacherId: teacher.id,
        status: "EN_COURS",
        dateStart: { lte: now },
        OR: [{ dateEnd: null }, { dateEnd: { gte: now } }],
      },
      select: { classId: true },
    });
    for (const assignment of assignments) classIds.add(assignment.classId);
  }
  if (userRoles.includes(PersonRole.TIT)) {
    const titulariats = await prisma.titulariat.findMany({
      where: {
        teacherId: teacher.id,
        dateStart: { lte: now },
        OR: [{ dateEnd: null }, { dateEnd: { gte: now } }],
      },
      select: { classId: true },
    });
    for (const titulariat of titulariats) classIds.add(titulariat.classId);
  }
  return scoped.map((item) => item.id).filter((id) => classIds.has(id));
}

async function assignedTeacher(auth: JwtPayload, classId: string, subjectId: string, yearId: string, onDate: Date) {
  const teacher = await prisma.teacher.findUnique({ where: { personId: auth.personId } });
  if (!teacher || (teacher.dateDeparture && teacher.dateDeparture < onDate)) return null;
  const assignment = await prisma.teachingAssignment.findFirst({
    where: {
      teacherId: teacher.id,
      classId,
      subjectId,
      yearId,
      status: "EN_COURS",
      dateStart: { lte: onDate },
      OR: [{ dateEnd: null }, { dateEnd: { gte: onDate } }],
    },
  });
  return assignment ? teacher : null;
}

app.use("/api", createJ3Router({
  prisma,
  authenticate,
  requireRole,
  currentAuth,
  canAccessClass,
  writeAudit,
}));
app.use("/api", createFinanceRouter({
  prisma,
  authenticate,
  requireRole,
  currentAuth,
  writeAudit,
}));
app.use("/api", createWorkloadRouter({
  prisma,
  authenticate,
  requireRole,
  currentAuth,
  canAccessClass,
}));
app.use("/api", createSiteRouter({
  prisma,
  authenticate,
  currentAuth,
  writeAudit,
}));

app.get("/api/health", (_req, res) => res.json({ status: "ok" }));

app.post("/api/auth/login", async (req, res) => {
  try {
    const parsed = z.object({
      identifier: z.string().min(1),
      password: z.string().min(1),
      otp: z.string().regex(/^\d{6}$/).optional(),
    }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Identifiant ou mot de passe invalide" });
    const now = new Date();
    const user = await prisma.user.findUnique({
      where: { identifier: parsed.data.identifier },
      include: {
        roles: {
          where: {
            dateStart: { lte: now },
            OR: [{ dateEnd: null }, { dateEnd: { gte: now } }],
          },
          include: { role: true },
        },
      },
    });
    if (!user || !user.active || (user.lockedUntil && user.lockedUntil > new Date())) {
      return res.status(401).json({ error: "Identifiant ou mot de passe invalide" });
    }
    if (!(await bcrypt.compare(parsed.data.password, user.passwordHash))) {
      const failedAttempts = user.failedAttempts + 1;
      await prisma.user.update({
        data: {
          failedAttempts,
          lockedUntil: failedAttempts >= 5 ? new Date(Date.now() + 15 * 60 * 1000) : null,
        },
        where: { id: user.id },
      });
      return res.status(401).json({ error: "Identifiant ou mot de passe invalide" });
    }
    if (user.twoFactorActive && !parsed.data.otp) {
      return res.json({ requiresTwoFactor: true });
    }
    if (user.twoFactorActive &&
        (!user.twoFactorSecret || !verifyTotp(decryptTotpSecret(user.twoFactorSecret, totpEncryptionKey), parsed.data.otp ?? ""))) {
      const failedAttempts = user.failedAttempts + 1;
      await prisma.user.update({
        data: {
          failedAttempts,
          lockedUntil: failedAttempts >= 5 ? new Date(Date.now() + 15 * 60 * 1000) : null,
        },
        where: { id: user.id },
      });
      return res.status(401).json({ error: "Identifiant, mot de passe ou code de vérification invalide" });
    }
    await prisma.user.update({ where: { id: user.id }, data: { failedAttempts: 0, lockedUntil: null, lastLogin: new Date() } });
    const roles = user.roles.map((item) => ({ code: item.role.code, scopeType: item.scopeType, scopeId: item.scopeId }));
    const token = jwt.sign({ sub: user.id, personId: user.personId, roles } satisfies JwtPayload, jwtSecret, { expiresIn: "30m" });
    await writeAudit({ userId: user.id, action: "AUTH_LOGIN", entityType: "USER", entityId: user.id, req });
    res.json({ token, roles, identifier: user.identifier });
  } catch (error) {
    console.error("Erreur de connexion:", error);
    res.status(500).json({ error: "Connexion impossible à la base de données" });
  }
});

app.post("/api/auth/totp/setup", authenticate, async (req, res) => {
  const parsed = z.object({ password: z.string().min(1) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Mot de passe requis" });
  const auth = currentAuth(req);
  const user = await prisma.user.findUnique({ where: { id: auth.sub }, include: { person: true } });
  if (!user || !(await bcrypt.compare(parsed.data.password, user.passwordHash))) {
    return res.status(401).json({ error: "Authentification invalide" });
  }
  if (user.twoFactorActive) return res.status(409).json({ error: "La double authentification est déjà activée" });
  const identity = await prisma.schoolIdentity.findUnique({ where: { id: "school" } });
  const secret = generateTotpSecret();
  await prisma.user.update({
    where: { id: user.id },
    data: { twoFactorSecret: encryptTotpSecret(secret, totpEncryptionKey) },
  });
  await writeAudit({
    userId: user.id,
    action: "AUTH_TOTP_SETUP",
    entityType: "USER",
    entityId: user.id,
    newValue: { twoFactorPending: true },
    req,
  });
  const issuer = identity?.schoolName ?? "Etablissement scolaire";
  const label = `${issuer}:${user.identifier}`;
  const otpauthUri = `otpauth://totp/${encodeURIComponent(label)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
  res.json({ secret, otpauthUri, enabled: false });
});

app.post("/api/auth/totp/enable", authenticate, async (req, res) => {
  const parsed = z.object({ code: z.string().regex(/^\d{6}$/) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Code de vérification invalide" });
  const auth = currentAuth(req);
  const user = await prisma.user.findUnique({ where: { id: auth.sub } });
  if (!user?.twoFactorSecret ||
      !verifyTotp(decryptTotpSecret(user.twoFactorSecret, totpEncryptionKey), parsed.data.code)) {
    return res.status(400).json({ error: "Code de vérification invalide" });
  }
  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { twoFactorActive: true },
    select: { twoFactorActive: true },
  });
  await writeAudit({ userId: auth.sub, action: "AUTH_TOTP_ENABLE", entityType: "USER", entityId: auth.sub, req });
  res.json(updated);
});

app.post("/api/auth/totp/disable", authenticate, async (req, res) => {
  const parsed = z.object({
    password: z.string().min(1),
    code: z.string().regex(/^\d{6}$/),
  }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Mot de passe et code de vérification requis" });
  const auth = currentAuth(req);
  const user = await prisma.user.findUnique({ where: { id: auth.sub } });
  if (!user || !(await bcrypt.compare(parsed.data.password, user.passwordHash)) ||
      !user.twoFactorSecret ||
      !verifyTotp(decryptTotpSecret(user.twoFactorSecret, totpEncryptionKey), parsed.data.code)) {
    return res.status(401).json({ error: "Authentification invalide" });
  }
  await prisma.user.update({
    where: { id: user.id },
    data: { twoFactorActive: false, twoFactorSecret: null },
  });
  await writeAudit({ userId: auth.sub, action: "AUTH_TOTP_DISABLE", entityType: "USER", entityId: auth.sub, req });
  res.json({ twoFactorActive: false });
});

app.get("/api/me", authenticate, async (req, res) => {
  const auth = (req as any).auth as JwtPayload;
  const now = new Date();
  const user = await prisma.user.findUnique({
    where: { id: auth.sub },
    include: {
      person: true,
      roles: {
        where: { dateStart: { lte: now }, OR: [{ dateEnd: null }, { dateEnd: { gte: now } }] },
        include: {
          role: { include: { permissions: { include: { permission: true } } } },
        },
      },
    },
  });
  if (!user) return res.status(404).json({ error: "Utilisateur introuvable" });
  res.json({
    id: user.id,
    identifier: user.identifier,
    person: user.person,
    roles: user.roles,
    twoFactorActive: user.twoFactorActive,
  });
});

app.get("/api/audit", authenticate, requireRole(PersonRole.ADM, PersonRole.DIR), async (_req, res) => {
  const logs = await prisma.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: 500 });
  res.json(logs);
});

app.get("/api/years", authenticate, async (_req, res) => {
  res.json(await prisma.academicYear.findMany({ include: { periods: true }, orderBy: { dateStart: "desc" } }));
});

app.post("/api/years", authenticate, requireRole(PersonRole.DIR), async (req, res) => {
  const parsed = z.object({
    label: z.string().min(4),
    dateStart: z.coerce.date(),
    dateEnd: z.coerce.date(),
    status: z.enum(["PREPARATION", "ACTIVE", "EN_CLOTURE", "ARCHIVE"]),
  }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: z.prettifyError(parsed.error) });
  if (parsed.data.status === "ACTIVE") {
    await prisma.academicYear.updateMany({ where: { status: "ACTIVE" }, data: { status: "ARCHIVE" } });
  }
  const year = await prisma.academicYear.create({ data: parsed.data });
  await writeAudit({ userId: (req as any).auth.sub, action: "YEAR_CREATE", entityType: "ACADEMIC_YEAR", entityId: year.id, newValue: year, req });
  res.status(201).json(year);
});

app.get("/api/classes", authenticate, async (req, res) => {
  const auth = currentAuth(req);
  if (auth.roles.some((role) => role.code === PersonRole.PAR)) {
    const linkedClasses = await prisma.schoolClass.findMany({
      where: {
        ...(req.query.yearId ? { yearId: String(req.query.yearId) } : {}),
        enrollments: {
          some: { student: { guardians: { some: { personId: auth.personId } } } },
        },
      },
      include: { year: true, pathway: { include: { level: { include: { cycle: true } }, filiere: true } } },
      orderBy: { name: "asc" },
    });
    return res.json(linkedClasses);
  }
  const classRoles: PersonRole[] = [PersonRole.DIR, PersonRole.CEN, PersonRole.SG, PersonRole.SEC, PersonRole.PROF, PersonRole.TIT, PersonRole.VERIFICATEUR, PersonRole.SUPPLEANT_VERIF];
  if (!auth.roles.some((role) => classRoles.includes(role.code))) {
    return res.status(403).json({ error: "Accès refusé à la structure des classes" });
  }
  const yearId = String(req.query.yearId ?? "");
  const classIds = await accessibleClassIds(auth);
  if (!classIds.length) return res.json([]);
  const classes = await prisma.schoolClass.findMany({
    where: { id: { in: classIds }, ...(yearId ? { yearId } : {}) },
    include: { year: true, pathway: { include: { level: { include: { cycle: true } }, filiere: true } }, titulariats: { include: { teacher: { include: { person: true } } } } },
    orderBy: { name: "asc" },
  });
  res.json(classes);
});

app.post("/api/classes", authenticate, requireRole(PersonRole.DIR, PersonRole.CEN), async (req, res) => {
  const parsed = z.object({
    yearId: z.string().uuid(),
    pathwayId: z.string().uuid(),
    name: z.string().min(1),
    maxCapacity: z.coerce.number().int().positive().optional(),
  }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: z.prettifyError(parsed.error) });
  try {
    const schoolClass = await prisma.schoolClass.create({ data: parsed.data });
    await writeAudit({ userId: (req as any).auth.sub, action: "CLASS_CREATE", entityType: "CLASS", entityId: schoolClass.id, newValue: schoolClass, req });
    res.status(201).json(schoolClass);
  } catch (error: any) {
    if (error.code === "P2002") return res.status(409).json({ error: "Une classe porte déjà ce nom pour cette année" });
    throw error;
  }
});

app.get("/api/students", authenticate, async (req, res) => {
  const auth = currentAuth(req);
  const search = String(req.query.search ?? "").trim();
  const roles = auth.roles.map((role) => role.code);
  if (roles.includes(PersonRole.ADM)) {
    return res.status(403).json({ error: "L'administrateur technique ne consulte pas les dossiers métier" });
  }
  let visibility: any;
  if (roles.includes(PersonRole.PAR)) {
    visibility = { guardians: { some: { personId: auth.personId } } };
  } else if (roles.includes(PersonRole.ELE)) {
    visibility = { personId: auth.personId };
  } else {
    const studentRoles: PersonRole[] = [PersonRole.DIR, PersonRole.CEN, PersonRole.SG, PersonRole.SEC, PersonRole.PROF, PersonRole.TIT, PersonRole.VERIFICATEUR, PersonRole.SUPPLEANT_VERIF];
    if (!roles.some((role) => studentRoles.includes(role))) {
      return res.status(403).json({ error: "Accès refusé aux dossiers des élèves" });
    }
    const classIds = await accessibleClassIds(auth);
    if (!classIds.length) return res.json([]);
    visibility = { enrollments: { some: { classId: { in: classIds }, status: "ACTIVE" } } };
  }
  const students = await prisma.student.findMany({
    where: {
      ...visibility,
      ...(search ? { person: { OR: [{ nom: { contains: search, mode: "insensitive" } }, { prenoms: { contains: search, mode: "insensitive" } }, { nom: { contains: search.replace(/-/g, " "), mode: "insensitive" } }] } } : {}),
    },
    include: { person: true, enrollments: { include: { class: true, year: true }, where: { status: "ACTIVE" } } },
    take: 100,
    orderBy: { person: { nom: "asc" } },
  });
  res.json(students);
});

app.post("/api/students", authenticate, requireRole(PersonRole.DIR, PersonRole.SEC), async (req, res) => {
  const parsed = z.object({
    nom: z.string().trim().min(1),
    prenoms: z.string().trim().min(1),
    sexe: z.string().optional(),
    dateNaissance: z.coerce.date().optional(),
    telephone: z.string().optional(),
  }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: z.prettifyError(parsed.error) });

  if (parsed.data.dateNaissance) {
    const duplicate = await prisma.person.findFirst({
      where: {
        nom: { equals: parsed.data.nom, mode: "insensitive" },
        prenoms: { equals: parsed.data.prenoms, mode: "insensitive" },
        dateNaissance: parsed.data.dateNaissance,
      },
    });
    if (duplicate) return res.status(409).json({ error: "Doublon détecté", duplicatePersonId: duplicate.id });
  }

  const result = await prisma.$transaction(async (tx) => {
    const person = await tx.person.create({ data: parsed.data });
    const year = await tx.academicYear.findFirst({ where: { status: "ACTIVE" } });
    const number = await tx.student.count();
    const matricule = buildMatricule(year?.label ?? "NOYEAR", number + 1);
    const student = await tx.student.create({
      data: {
        personId: person.id,
        matricule,
        dateAdmission: new Date(),
      },
    });
    return { person, student };
  });
  await writeAudit({ userId: (req as any).auth.sub, action: "STUDENT_CREATE", entityType: "STUDENT", entityId: result.student.id, newValue: result, req });
  res.status(201).json(result);
});

app.post("/api/enrollments", authenticate, requireRole(PersonRole.DIR, PersonRole.SEC), async (req, res) => {
  const parsed = z.object({
    studentId: z.string().uuid(),
    yearId: z.string().uuid(),
    classId: z.string().uuid(),
    type: z.enum(["NOUVEAU", "PASSANT", "REDOUBLANT", "TRANSFERT", "CHANGEMENT_FILIERE"]),
  }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: z.prettifyError(parsed.error) });
  try {
    const enrollment = await prisma.enrollment.create({
      data: { ...parsed.data, dateStart: new Date(), status: "ACTIVE" },
    });
    await writeAudit({ userId: (req as any).auth.sub, action: "ENROLLMENT_CREATE", entityType: "ENROLLMENT", entityId: enrollment.id, newValue: enrollment, req });
    res.status(201).json(enrollment);
  } catch (error: any) {
    if (error.code === "P2002") return res.status(409).json({ error: "L'élève a déjà une inscription pour cette année" });
    throw error;
  }
});

app.get("/api/teachers", authenticate, async (req, res) => {
  const auth = currentAuth(req);
  const roles = auth.roles.map((role) => role.code);
  const allowed: PersonRole[] = [PersonRole.DIR, PersonRole.CEN, PersonRole.SEC, PersonRole.PROF, PersonRole.TIT];
  if (!roles.some((role) => allowed.includes(role))) {
    return res.status(403).json({ error: "Accès refusé aux dossiers du personnel" });
  }
  const ownTeacher = await prisma.teacher.findUnique({ where: { personId: auth.personId } });
  const managementRoles: PersonRole[] = [PersonRole.DIR, PersonRole.CEN, PersonRole.SEC];
  const teachingRoles: PersonRole[] = [PersonRole.PROF, PersonRole.TIT];
  const ownOnly = roles.some((role) => teachingRoles.includes(role)) &&
    !roles.some((role) => managementRoles.includes(role));
  const teachers = await prisma.teacher.findMany({
    where: ownOnly ? { id: ownTeacher?.id ?? "__none__" } : undefined,
    include: { person: true, assignments: { include: { class: true, subject: true } }, titulariats: { include: { class: true } } },
  });
  res.json(teachers);
});

app.post("/api/teachers", authenticate, requireRole(PersonRole.DIR), async (req, res) => {
  const parsed = z.object({
    nom: z.string().min(1),
    prenoms: z.string().min(1),
    telephone: z.string().optional(),
    status: z.enum(["TITULAIRE_ETAT", "VOLONTAIRE", "VACATAIRE", "CONTRACTUEL"]),
    functionMatricule: z.string().optional(),
  }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: z.prettifyError(parsed.error) });
  const data = parsed.data;
  const result = await prisma.$transaction(async (tx) => {
    const person = await tx.person.create({ data: { nom: data.nom, prenoms: data.prenoms, telephone: data.telephone } });
    const teacher = await tx.teacher.create({
      data: { personId: person.id, status: data.status, functionMatricule: data.functionMatricule, specialties: [] },
    });
    return { person, teacher };
  });
  await writeAudit({ userId: (req as any).auth.sub, action: "TEACHER_CREATE", entityType: "TEACHER", entityId: result.teacher.id, newValue: result, req });
  res.status(201).json(result);
});

app.post("/api/assignments", authenticate, requireRole(PersonRole.DIR, PersonRole.CEN), async (req, res) => {
  const parsed = z.object({
    teacherId: z.string().uuid(),
    classId: z.string().uuid(),
    subjectId: z.string().uuid(),
    yearId: z.string().uuid(),
    weeklyHours: z.coerce.number().nonnegative(),
    dateStart: z.coerce.date(),
    dateEnd: z.coerce.date().optional(),
  }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: z.prettifyError(parsed.error) });
  try {
    assertDateRange(parsed.data.dateStart, parsed.data.dateEnd);
  } catch (error: any) {
    return res.status(400).json({ error: error.message });
  }
  const existing = await prisma.teachingAssignment.findFirst({
    where: {
      classId: parsed.data.classId,
      subjectId: parsed.data.subjectId,
      yearId: parsed.data.yearId,
      status: "EN_COURS",
      AND: [
        { dateStart: { lte: parsed.data.dateEnd ?? new Date("2099-12-31") } },
        { OR: [{ dateEnd: null }, { dateEnd: { gte: parsed.data.dateStart } }] },
      ],
    },
  });
  if (existing) return res.status(409).json({ error: "Une affectation active existe déjà pour cette classe et matière" });
  const assignment = await prisma.teachingAssignment.create({
    data: { ...parsed.data, weeklyHours: parsed.data.weeklyHours, createdBy: (req as any).auth.sub },
  });
  await writeAudit({ userId: (req as any).auth.sub, action: "ASSIGNMENT_CREATE", entityType: "ASSIGNMENT", entityId: assignment.id, newValue: assignment, req });
  res.status(201).json(assignment);
});

app.post("/api/import/students", authenticate, requireRole(PersonRole.SEC), upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Fichier Excel requis" });
  const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet);
  const report: { line: number; errors: string[]; row: Record<string, unknown> }[] = [];
  let valid = 0;
  rows.forEach((row, index) => {
    const errors: string[] = [];
    if (!String(row.nom ?? "").trim()) errors.push("nom manquant");
    if (!String(row.prenoms ?? "").trim()) errors.push("prénoms manquants");
    if (errors.length) report.push({ line: index + 2, errors, row });
    else valid++;
  });
  await writeAudit({ userId: (req as any).auth.sub, action: "IMPORT_DRY_RUN", entityType: "STUDENT_IMPORT", newValue: { valid, errors: report.length }, req });
  res.json({ preview: true, total: rows.length, valid, errors: report });
});

app.get("/api/subjects", authenticate, async (req, res) => {
  const auth = currentAuth(req);
  const roles = auth.roles.map((role) => role.code);
  if (roles.includes(PersonRole.ADM)) return res.status(403).json({ error: "L'administrateur technique ne consulte pas les données pédagogiques" });
  const teacher = await prisma.teacher.findUnique({ where: { personId: auth.personId } });
  const subjects = await prisma.subject.findMany({
    where: teacher && roles.includes(PersonRole.PROF)
      ? { assignments: { some: { teacherId: teacher.id, status: "EN_COURS", dateStart: { lte: new Date() }, OR: [{ dateEnd: null }, { dateEnd: { gte: new Date() } }] } } }
      : undefined,
    orderBy: { label: "asc" },
  });
  res.json(subjects);
});

app.post("/api/subjects", authenticate, requireRole(PersonRole.DIR, PersonRole.CEN), async (req, res) => {
  const parsed = z.object({ code: z.string().trim().min(1), label: z.string().trim().min(1), abbreviation: z.string().trim().min(1), category: z.string().optional() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: z.prettifyError(parsed.error) });
  const subject = await prisma.subject.create({ data: parsed.data });
  await writeAudit({ userId: (req as any).auth.sub, action: "SUBJECT_CREATE", entityType: "SUBJECT", entityId: subject.id, newValue: subject, req });
  res.status(201).json(subject);
});

app.get("/api/assessments", authenticate, async (req, res) => {
  const auth = currentAuth(req);
  const classId = String(req.query.classId ?? "");
  const yearId = String(req.query.yearId ?? "");
  const periodId = String(req.query.periodId ?? "");
  const subjectFilter = classId ? await canAccessClass(auth, classId) : false;
  if (classId && !subjectFilter) return res.status(403).json({ error: "Cette classe est hors de votre portée" });
  const teacher = await prisma.teacher.findUnique({ where: { personId: auth.personId } });
  const reviewerRoles: PersonRole[] = [PersonRole.SEC, PersonRole.CEN, PersonRole.VERIFICATEUR, PersonRole.SUPPLEANT_VERIF, PersonRole.DIR];
  if (!subjectFilter && !teacher && !auth.roles.some((role) => reviewerRoles.includes(role.code))) {
    return res.status(403).json({ error: "Accès refusé à ces évaluations" });
  }
  const where: any = {
    ...(classId ? { classId } : {}),
    ...(yearId ? { yearId } : {}),
    ...(periodId ? { periodId } : {}),
  };
  const privilegedReviewer = auth.roles.some((role) => reviewerRoles.includes(role.code));
  if (!privilegedReviewer && teacher && auth.roles.some((role) => role.code === PersonRole.PROF)) where.teacherId = teacher.id;
  if (!privilegedReviewer && auth.roles.some((role) => role.code === PersonRole.TIT)) {
    const classIds = await accessibleClassIds(auth);
    where.classId = classId && classIds.includes(classId) ? classId : { in: classIds };
  }
  if (!subjectFilter && !teacher && privilegedReviewer) {
    const classes = await accessibleClassIds(auth);
    where.classId = classId ? classId : { in: classes };
  }
  const assessments = await prisma.assessment.findMany({
    where,
    include: {
      class: true,
      subject: true,
      teacher: { include: { person: true } },
      marks: { include: { student: { include: { person: true } } }, orderBy: { student: { person: { nom: "asc" } } } },
    },
    orderBy: { date: "desc" },
  });
  res.json(assessments);
});

app.post("/api/assessments", authenticate, requireRole(PersonRole.PROF), async (req, res) => {
  const auth = currentAuth(req);
  const parsed = z.object({
    classId: z.string().uuid(),
    subjectId: z.string().uuid(),
    periodId: z.string().uuid(),
    kind: z.enum(["INTERROGATION", "DEVOIR", "COMPOSITION"]),
    title: z.string().trim().min(1).max(120),
    date: z.coerce.date(),
    maxScore: z.coerce.number().positive(),
  }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: z.prettifyError(parsed.error) });

  const schoolClass = await prisma.schoolClass.findUnique({
    where: { id: parsed.data.classId },
    include: { year: true, pathway: true },
  });
  const period = await prisma.period.findUnique({ where: { id: parsed.data.periodId } });
  if (!schoolClass || !period || period.yearId !== schoolClass.yearId) {
    return res.status(400).json({ error: "La période ne correspond pas à l'année de la classe" });
  }
  if (parsed.data.date < period.dateStart || parsed.data.date > period.dateEnd) {
    return res.status(400).json({ error: "La date de l'évaluation est hors de la période choisie" });
  }
  const assignment = await assignedTeacher(auth, schoolClass.id, parsed.data.subjectId, schoolClass.yearId, parsed.data.date);
  if (!assignment) return res.status(403).json({ error: "Vous n'avez pas d'affectation active pour cette classe et cette matière" });
  const program = await prisma.subjectProgram.findFirst({
    where: { yearId: schoolClass.yearId, pathwayId: schoolClass.pathwayId, subjectId: parsed.data.subjectId },
  });
  if (!program) return res.status(400).json({ error: "Cette matière n'est pas au programme de la classe pour cette année" });
  if (parsed.data.maxScore > Number(program.scale)) {
    return res.status(400).json({ error: `Le barème ne peut pas dépasser ${program.scale}` });
  }
  const enrolled = await prisma.enrollment.findMany({
    where: { classId: schoolClass.id, yearId: schoolClass.yearId, status: "ACTIVE" },
    select: { studentId: true },
    orderBy: { student: { person: { nom: "asc" } } },
  });
  if (!enrolled.length) return res.status(409).json({ error: "La classe n'a aucun élève inscrit pour cette année" });

  const assessment = await prisma.assessment.create({
    data: {
      ...parsed.data,
      yearId: schoolClass.yearId,
      teacherId: assignment.id,
      sheetNumber: `FE-${Date.now()}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`,
      qrToken: crypto.randomBytes(24).toString("hex"),
      marks: {
        create: enrolled.map(({ studentId }) => ({
          studentId,
          scale: parsed.data.maxScore,
          status: "NON_NOTE",
        })),
      },
    },
    include: { marks: true },
  });
  await writeAudit({ userId: auth.sub, action: "ASSESSMENT_CREATE", entityType: "ASSESSMENT", entityId: assessment.id, newValue: { ...assessment, marks: assessment.marks.length }, req });
  res.status(201).json(assessment);
});

app.put("/api/assessments/:id/marks", authenticate, requireRole(PersonRole.PROF), async (req, res) => {
  const auth = currentAuth(req);
  const assessmentId = String(req.params.id);
  const parsed = z.object({
    marks: z.array(z.object({
      studentId: z.string().uuid(),
      status: z.enum(["NOTE", "ABSENT_JUSTIFIE", "ABSENT_NON_JUSTIFIE", "DISPENSE", "NON_NOTE"]),
      value: z.coerce.number().nonnegative().optional(),
      comment: z.string().max(500).optional(),
    })).min(1),
  }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: z.prettifyError(parsed.error) });
  const assessment = await prisma.assessment.findUnique({
    where: { id: assessmentId },
    include: { class: true, teacher: true, marks: true },
  });
  if (!assessment) return res.status(404).json({ error: "Évaluation introuvable" });
  if (assessment.teacher.personId !== auth.personId) return res.status(403).json({ error: "Seul le professeur auteur peut saisir cette feuille" });
  if (!["BROUILLON", "RENVOYEE"].includes(assessment.status)) return res.status(409).json({ error: "Cette feuille a été soumise et n'est plus modifiable" });

  const allowedStudents = new Set(assessment.marks.map((mark) => mark.studentId));
  for (const mark of parsed.data.marks) {
    if (!allowedStudents.has(mark.studentId)) return res.status(400).json({ error: "Un élève ne fait pas partie de cette feuille" });
    try {
      validateMark(mark.status, mark.value, Number(assessment.maxScore));
    } catch (error) {
      return res.status(400).json({ error: error instanceof Error ? error.message : "Note invalide" });
    }
  }
  const updated = await prisma.$transaction(parsed.data.marks.map((mark) =>
    prisma.studentMark.update({
      where: { assessmentId_studentId: { assessmentId, studentId: mark.studentId } },
      data: { status: mark.status, value: mark.value, comment: mark.comment },
    }),
  ));
  await writeAudit({ userId: auth.sub, action: "MARKS_SAVE", entityType: "ASSESSMENT", entityId: assessment.id, newValue: { changed: updated.length }, req });
  res.json({ updated: updated.length });
});

app.post("/api/assessments/:id/submit", authenticate, requireRole(PersonRole.PROF), async (req, res) => {
  const auth = currentAuth(req);
  const id = String(req.params.id);
  const assessment = await prisma.assessment.findUnique({ where: { id }, include: { teacher: true, marks: true } });
  if (!assessment) return res.status(404).json({ error: "Évaluation introuvable" });
  if (assessment.teacher.personId !== auth.personId) return res.status(403).json({ error: "Seul le professeur auteur peut soumettre cette feuille" });
  if (!["BROUILLON", "RENVOYEE"].includes(assessment.status)) return res.status(409).json({ error: "Cette feuille a déjà été soumise" });
  if (assessment.marks.some((mark) => mark.status === "NON_NOTE")) {
    return res.status(409).json({ error: "Renseignez une note, une absence ou une dispense pour chaque élève avant de soumettre" });
  }
  const submitted = await prisma.assessment.update({
    where: { id },
    data: { status: "SOUMISE", submittedAt: new Date(), returnedComment: null },
  });
  await writeAudit({ userId: auth.sub, action: "ASSESSMENT_SUBMIT", entityType: "ASSESSMENT", entityId: id, newValue: submitted, req });
  res.json(submitted);
});

app.post("/api/assessments/:id/return", authenticate, requireRole(PersonRole.CEN, PersonRole.SEC, PersonRole.VERIFICATEUR, PersonRole.SUPPLEANT_VERIF), async (req, res) => {
  const auth = currentAuth(req);
  const id = String(req.params.id);
  const parsed = z.object({ comment: z.string().trim().min(1).max(1000) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Un motif de renvoi est obligatoire" });
  const assessment = await prisma.assessment.findUnique({ where: { id } });
  if (!assessment) return res.status(404).json({ error: "Évaluation introuvable" });
  if (!await canAccessClass(auth, assessment.classId)) return res.status(403).json({ error: "Cette classe est hors de votre portée" });
  if (assessment.teacherId === (await prisma.teacher.findUnique({ where: { personId: auth.personId } }))?.id) {
    return res.status(403).json({ error: "Vous ne pouvez pas vérifier votre propre saisie" });
  }
  if (assessment.status !== "SOUMISE") return res.status(409).json({ error: "Seule une feuille soumise peut être renvoyée" });
  const returned = await prisma.assessment.update({
    where: { id },
    data: { status: "RENVOYEE", returnedComment: parsed.data.comment, verifiedBy: auth.sub, verifiedAt: new Date() },
  });
  await writeAudit({ userId: auth.sub, action: "ASSESSMENT_RETURN", entityType: "ASSESSMENT", entityId: id, reason: parsed.data.comment, req });
  res.json(returned);
});

app.put("/api/assessments/:id/checks", authenticate, requireRole(PersonRole.CEN, PersonRole.SEC, PersonRole.VERIFICATEUR, PersonRole.SUPPLEANT_VERIF), async (req, res) => {
  const auth = currentAuth(req);
  const id = String(req.params.id);
  const parsed = z.object({
    markIds: z.array(z.string().uuid()).min(1),
    paperRef: z.string().max(500).optional(),
  }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: z.prettifyError(parsed.error) });
  const assessment = await prisma.assessment.findUnique({ where: { id }, include: { marks: true } });
  if (!assessment) return res.status(404).json({ error: "Évaluation introuvable" });
  if (assessment.status !== "SOUMISE") return res.status(409).json({ error: "Seule une feuille soumise peut être vérifiée" });
  if (!await canAccessClass(auth, assessment.classId)) return res.status(403).json({ error: "Cette classe est hors de votre portée" });
  const ownTeacher = await prisma.teacher.findUnique({ where: { personId: auth.personId } });
  if (assessment.teacherId === ownTeacher?.id) return res.status(403).json({ error: "Vous ne pouvez pas vérifier votre propre saisie" });
  const allowedMarkIds = new Set(assessment.marks.map((mark) => mark.id));
  if (parsed.data.markIds.some((markId) => !allowedMarkIds.has(markId))) {
    return res.status(400).json({ error: "Une ligne sélectionnée ne fait pas partie de cette feuille" });
  }
  await prisma.$transaction(async (tx) => {
    for (const markId of parsed.data.markIds) {
      await tx.markCheck.upsert({
        where: { markId_verifierId: { markId, verifierId: auth.sub } },
        create: { markId, verifierId: auth.sub, checked: true, checkedAt: new Date() },
        update: { checked: true, checkedAt: new Date() },
      });
    }
    if (parsed.data.paperRef !== undefined) {
      await tx.assessment.update({ where: { id }, data: { paperRef: parsed.data.paperRef } });
    }
  });
  res.json({ checked: parsed.data.markIds.length, total: assessment.marks.length });
});

app.post("/api/assessments/:id/verify", authenticate, requireRole(PersonRole.CEN, PersonRole.SEC, PersonRole.VERIFICATEUR, PersonRole.SUPPLEANT_VERIF), async (req, res) => {
  const auth = currentAuth(req);
  const id = String(req.params.id);
  const assessment = await prisma.assessment.findUnique({ where: { id }, include: { marks: { include: { checks: true } } } });
  if (!assessment) return res.status(404).json({ error: "Évaluation introuvable" });
  if (assessment.status !== "SOUMISE") return res.status(409).json({ error: "Seule une feuille soumise peut être validée" });
  if (!await canAccessClass(auth, assessment.classId)) return res.status(403).json({ error: "Cette classe est hors de votre portée" });
  const ownTeacher = await prisma.teacher.findUnique({ where: { personId: auth.personId } });
  if (assessment.teacherId === ownTeacher?.id) return res.status(403).json({ error: "Vous ne pouvez pas vérifier votre propre saisie" });
  if (!assessment.marks.length || assessment.marks.some((mark) =>
    !mark.checks.some((check) => check.verifierId === auth.sub && check.checked),
  )) {
    return res.status(409).json({ error: "Cochez chaque ligne après vérification de la feuille signée" });
  }
  const verified = await prisma.assessment.update({
    where: { id },
    data: { status: "VALIDEE", verifiedAt: new Date(), verifiedBy: auth.sub },
  });
  await writeAudit({ userId: auth.sub, action: "ASSESSMENT_VERIFY", entityType: "ASSESSMENT", entityId: id, newValue: verified, req });
  res.json(verified);
});

app.post("/api/marks/:id/corrections", authenticate, requireRole(PersonRole.PROF), async (req, res) => {
  const auth = currentAuth(req);
  const id = String(req.params.id);
  const parsed = z.object({
    newValue: z.coerce.number().nonnegative(),
    reason: z.string().trim().min(1).max(1000),
  }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: z.prettifyError(parsed.error) });
  const mark = await prisma.studentMark.findUnique({ where: { id }, include: { assessment: { include: { teacher: true } } } });
  if (!mark) return res.status(404).json({ error: "Note introuvable" });
  if (mark.assessment.teacher.personId !== auth.personId) return res.status(403).json({ error: "Seul le professeur auteur peut demander une correction" });
  if (mark.assessment.status !== "VALIDEE") return res.status(409).json({ error: "La correction est réservée aux feuilles déjà validées" });
  if (mark.status !== "NOTE") return res.status(409).json({ error: "Cette ligne n'est pas une note numérique à corriger" });
  if (parsed.data.newValue > Number(mark.scale)) {
    return res.status(400).json({ error: `La note ne peut pas dépasser le barème de ${mark.scale}` });
  }
  const correction = await prisma.markCorrection.create({
    data: {
      markId: id,
      requestedBy: auth.sub,
      oldValue: mark.value,
      newValue: parsed.data.newValue,
      reason: parsed.data.reason,
    },
  });
  await writeAudit({ userId: auth.sub, action: "MARK_CORRECTION_REQUEST", entityType: "MARK_CORRECTION", entityId: correction.id, oldValue: mark.value, newValue: parsed.data.newValue, reason: parsed.data.reason, req });
  res.status(201).json(correction);
});

app.post("/api/mark-corrections/:id/decision", authenticate, requireRole(PersonRole.CEN, PersonRole.SEC, PersonRole.VERIFICATEUR, PersonRole.SUPPLEANT_VERIF), async (req, res) => {
  const auth = currentAuth(req);
  const id = String(req.params.id);
  const parsed = z.object({ approve: z.boolean(), comment: z.string().max(1000).optional() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: z.prettifyError(parsed.error) });
  const correction = await prisma.markCorrection.findUnique({
    where: { id },
    include: { mark: { include: { assessment: true } } },
  });
  if (!correction) return res.status(404).json({ error: "Demande de correction introuvable" });
  if (correction.requestedBy === auth.sub) return res.status(403).json({ error: "Le demandeur ne peut pas approuver sa propre correction" });
  if (!await canAccessClass(auth, correction.mark.assessment.classId)) return res.status(403).json({ error: "Cette classe est hors de votre portée" });
  if (correction.status !== "EN_ATTENTE") return res.status(409).json({ error: "Cette demande a déjà été traitée" });
  const result = await prisma.$transaction(async (tx) => {
    if (parsed.data.approve) {
      await tx.studentMark.update({
        where: { id: correction.markId },
        data: { value: correction.newValue, status: correction.newValue === null ? "NON_NOTE" : "NOTE" },
      });
    }
    return tx.markCorrection.update({
      where: { id },
      data: {
        status: parsed.data.approve ? "APPROUVEE" : "REFUSEE",
        approvedBy: auth.sub,
        resolvedAt: new Date(),
      },
    });
  });
  await writeAudit({
    userId: auth.sub,
    action: parsed.data.approve ? "MARK_CORRECTION_APPROVE" : "MARK_CORRECTION_REJECT",
    entityType: "MARK_CORRECTION",
    entityId: id,
    oldValue: correction.oldValue,
    newValue: correction.newValue,
    reason: parsed.data.comment ?? correction.reason,
    req,
  });
  res.json(result);
});

app.post("/api/calculation-rules", authenticate, requireRole(PersonRole.DIR), async (req, res) => {
  const parsed = z.object({
    yearId: z.string().uuid(),
    cycleId: z.string().uuid(),
    classworkWeight: z.coerce.number().nonnegative(),
    compositionWeight: z.coerce.number().nonnegative(),
    annualPeriodWeights: z.array(z.coerce.number().nonnegative()).length(3),
    roundingDigits: z.number().int().min(0).max(4),
  }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: z.prettifyError(parsed.error) });
  if (parsed.data.classworkWeight + parsed.data.compositionWeight <= 0 ||
      parsed.data.annualPeriodWeights.every((weight) => weight === 0)) {
    return res.status(400).json({ error: "Au moins une pondération de calcul doit être positive" });
  }
  const auth = currentAuth(req);
  const rule = await prisma.$transaction(async (tx) => {
    const current = await tx.calculationRule.findFirst({
      where: { yearId: parsed.data.yearId, cycleId: parsed.data.cycleId },
      orderBy: { version: "desc" },
    });
    await tx.calculationRule.updateMany({
      where: { yearId: parsed.data.yearId, cycleId: parsed.data.cycleId, active: true },
      data: { active: false },
    });
    return tx.calculationRule.create({
      data: {
        ...parsed.data,
        annualPeriodWeights: parsed.data.annualPeriodWeights,
        version: (current?.version ?? 0) + 1,
        createdBy: auth.sub,
      },
    });
  });
  await writeAudit({ userId: auth.sub, action: "CALCULATION_RULE_CREATE", entityType: "CALCULATION_RULE", entityId: rule.id, newValue: rule, req });
  res.status(201).json(rule);
});

app.get("/api/calculation-rules", authenticate, async (req, res) => {
  const yearId = String(req.query.yearId ?? "");
  const rules = await prisma.calculationRule.findMany({
    where: yearId ? { yearId } : undefined,
    include: { cycle: true, year: true },
    orderBy: [{ year: { dateStart: "desc" } }, { version: "desc" }],
  });
  res.json(rules);
});

app.get("/api/reports/checklist", authenticate, requireRole(PersonRole.DIR, PersonRole.CEN, PersonRole.TIT), async (req, res) => {
  const auth = currentAuth(req);
  const parsed = z.object({ classId: z.string().uuid(), periodId: z.string().uuid() }).safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: "Classe et période obligatoires" });
  const schoolClass = await prisma.schoolClass.findUnique({
    where: { id: parsed.data.classId },
    include: { pathway: { include: { level: true } } },
  });
  const period = await prisma.period.findUnique({ where: { id: parsed.data.periodId } });
  if (!schoolClass || !period || period.yearId !== schoolClass.yearId) {
    return res.status(404).json({ error: "Classe ou période introuvable pour la même année" });
  }
  if (!await canAccessClass(auth, schoolClass.id)) return res.status(403).json({ error: "Cette classe est hors de votre portée" });
  if (auth.roles.some((role) => role.code === PersonRole.TIT)) {
    const ownTeacher = await prisma.teacher.findUnique({ where: { personId: auth.personId } });
    const titulariat = ownTeacher && await prisma.titulariat.findFirst({
      where: {
        classId: schoolClass.id,
        teacherId: ownTeacher.id,
        yearId: schoolClass.yearId,
        dateStart: { lte: new Date() },
        OR: [{ dateEnd: null }, { dateEnd: { gte: new Date() } }],
      },
    });
    if (!titulariat) return res.status(403).json({ error: "Cette classe n'est pas votre classe de titulariat" });
  }
  const [assessments, programs, enrollments, appreciations, rule] = await Promise.all([
    prisma.assessment.findMany({
      where: { classId: schoolClass.id, periodId: period.id },
      include: { subject: true, teacher: { include: { person: true } }, marks: true },
    }),
    prisma.subjectProgram.findMany({
      where: { yearId: schoolClass.yearId, pathwayId: schoolClass.pathwayId },
      include: { subject: true },
    }),
    prisma.enrollment.findMany({
      where: { classId: schoolClass.id, yearId: schoolClass.yearId, status: "ACTIVE" },
      select: { studentId: true },
    }),
    prisma.classAppreciation.count({ where: { classId: schoolClass.id, yearId: schoolClass.yearId, periodId: period.id } }),
    prisma.calculationRule.findFirst({
      where: { yearId: schoolClass.yearId, cycleId: schoolClass.pathway.level.cycleId, active: true },
    }),
  ]);
  const issues: { code: string; message: string; assessmentId?: string; subjectId?: string }[] = [];
  for (const assessment of assessments) {
    if (assessment.status !== "VALIDEE") {
      issues.push({
        code: "FEUILLE_NON_VALIDEE",
        message: `${schoolClass.name} : ${assessment.subject.label} (${assessment.teacher.person.nom}) n'est pas validée`,
        assessmentId: assessment.id,
        subjectId: assessment.subjectId,
      });
    }
    if (assessment.marks.some((mark) => mark.status === "NON_NOTE")) {
      issues.push({
        code: "NOTE_MANQUANTE",
        message: `${assessment.title} : des élèves n'ont pas encore de note ou de statut d'absence`,
        assessmentId: assessment.id,
        subjectId: assessment.subjectId,
      });
    }
  }
  if (!programs.length) {
    issues.push({ code: "PROGRAMME_ABSENT", message: `${schoolClass.name} : aucun programme matière n'est configuré pour l'année` });
  }
  for (const program of programs) {
    if (Number(program.coefficient) <= 0) {
      issues.push({ code: "COEFFICIENT_INVALIDE", message: `${schoolClass.name} : coefficient à compléter pour ${program.subject.label}`, subjectId: program.subjectId });
    }
    const hasTeacher = await prisma.teachingAssignment.findFirst({
      where: {
        classId: schoolClass.id,
        subjectId: program.subjectId,
        yearId: schoolClass.yearId,
        status: "EN_COURS",
        dateStart: { lte: period.dateEnd },
        OR: [{ dateEnd: null }, { dateEnd: { gte: period.dateStart } }],
      },
    });
    if (!hasTeacher) {
      issues.push({ code: "PROFESSEUR_ABSENT", message: `${schoolClass.name} : aucun professeur affecté en ${program.subject.label}`, subjectId: program.subjectId });
    }
    const hasValidAssessment = assessments.some((item) => item.subjectId === program.subjectId && item.status === "VALIDEE");
    if (!hasValidAssessment) {
      issues.push({ code: "MATIERE_NON_EVALUEE", message: `${schoolClass.name} : aucune feuille validée en ${program.subject.label}`, subjectId: program.subjectId });
    }
    if (rule && rule.classworkWeight.toNumber() > 0 &&
        !assessments.some((item) => item.subjectId === program.subjectId && item.status === "VALIDEE" && item.kind !== "COMPOSITION")) {
      issues.push({ code: "CONTROLE_CONTINU_MANQUANT", message: `${schoolClass.name} : contrôle continu non validé en ${program.subject.label}`, subjectId: program.subjectId });
    }
    if (rule && rule.compositionWeight.toNumber() > 0 &&
        !assessments.some((item) => item.subjectId === program.subjectId && item.status === "VALIDEE" && item.kind === "COMPOSITION")) {
      issues.push({ code: "COMPOSITION_MANQUANTE", message: `${schoolClass.name} : composition non validée en ${program.subject.label}`, subjectId: program.subjectId });
    }
  }
  const missingAppreciations = Math.max(enrollments.length - appreciations, 0);
  if (missingAppreciations) {
    issues.push({ code: "APPRECIATION_MANQUANTE", message: `${schoolClass.name} : ${missingAppreciations} appréciation(s) du titulaire manquante(s)` });
  }
  if (!rule) {
    issues.push({ code: "REGLE_CALCUL_ABSENTE", message: `${schoolClass.name} : aucune règle de calcul active pour cette année et ce cycle` });
  }
  res.json({ class: schoolClass.name, period: period.label, ready: issues.length === 0, issues });
});

app.put("/api/classes/:classId/appreciations", authenticate, requireRole(PersonRole.TIT), async (req, res) => {
  const auth = currentAuth(req);
  const classId = String(req.params.classId);
  const parsed = z.object({
    yearId: z.string().uuid(),
    periodId: z.string().uuid(),
    entries: z.array(z.object({
      studentId: z.string().uuid(),
      text: z.string().trim().min(1).max(1500),
      councilOpinion: z.string().max(500).optional(),
    })).min(1),
  }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: z.prettifyError(parsed.error) });
  const teacher = await prisma.teacher.findUnique({ where: { personId: auth.personId } });
  const titulariat = teacher && await prisma.titulariat.findFirst({
    where: {
      classId,
      yearId: parsed.data.yearId,
      teacherId: teacher.id,
      dateStart: { lte: new Date() },
      OR: [{ dateEnd: null }, { dateEnd: { gte: new Date() } }],
    },
  });
  if (!titulariat) return res.status(403).json({ error: "Seul le titulaire actif peut saisir les appréciations de cette classe" });
  const period = await prisma.period.findUnique({ where: { id: parsed.data.periodId } });
  if (!period || period.yearId !== parsed.data.yearId) return res.status(400).json({ error: "Période et année incompatibles" });
  const students = await prisma.enrollment.findMany({
    where: { classId, yearId: parsed.data.yearId, status: "ACTIVE" },
    select: { studentId: true },
  });
  const allowedStudents = new Set(students.map((item) => item.studentId));
  if (parsed.data.entries.some((entry) => !allowedStudents.has(entry.studentId))) {
    return res.status(400).json({ error: "Une appréciation concerne un élève qui n'est pas inscrit dans cette classe" });
  }
  const saved = await prisma.$transaction(parsed.data.entries.map((entry) =>
    prisma.classAppreciation.upsert({
      where: { studentId_yearId_periodId: { studentId: entry.studentId, yearId: parsed.data.yearId, periodId: parsed.data.periodId } },
      create: { ...entry, classId, teacherId: teacher!.id, yearId: parsed.data.yearId, periodId: parsed.data.periodId },
      update: { text: entry.text, councilOpinion: entry.councilOpinion, classId, teacherId: teacher!.id },
    }),
  ));
  await writeAudit({ userId: auth.sub, action: "CLASS_APPRECIATIONS_SAVE", entityType: "CLASS", entityId: classId, newValue: { count: saved.length }, req });
  res.json({ saved: saved.length });
});

app.post("/api/report-cards/generate", authenticate, requireRole(PersonRole.DIR, PersonRole.CEN), async (req, res) => {
  const auth = currentAuth(req);
  const parsed = z.object({ classId: z.string().uuid(), periodId: z.string().uuid() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Classe et période obligatoires" });
  const schoolClass = await prisma.schoolClass.findUnique({
    where: { id: parsed.data.classId },
    include: { pathway: { include: { level: true } } },
  });
  const period = await prisma.period.findUnique({ where: { id: parsed.data.periodId } });
  if (!schoolClass || !period || schoolClass.yearId !== period.yearId) {
    return res.status(404).json({ error: "Classe ou période introuvable pour la même année" });
  }
  if (!await canAccessClass(auth, schoolClass.id)) return res.status(403).json({ error: "Cette classe est hors de votre portée" });
  const [assessments, programs, enrollments, rule, appreciations, schoolIdentity] = await Promise.all([
    prisma.assessment.findMany({
      where: { classId: schoolClass.id, periodId: period.id, status: "VALIDEE" },
      include: { subject: true, marks: true },
    }),
    prisma.subjectProgram.findMany({
      where: { yearId: schoolClass.yearId, pathwayId: schoolClass.pathwayId },
      include: { subject: true },
    }),
    prisma.enrollment.findMany({
      where: { classId: schoolClass.id, yearId: schoolClass.yearId, status: "ACTIVE" },
      include: { student: { include: { person: true } } },
      orderBy: { student: { person: { nom: "asc" } } },
    }),
    prisma.calculationRule.findFirst({
      where: { yearId: schoolClass.yearId, cycleId: schoolClass.pathway.level.cycleId, active: true },
    }),
    prisma.classAppreciation.findMany({
      where: { classId: schoolClass.id, yearId: schoolClass.yearId, periodId: period.id },
    }),
    prisma.schoolIdentity.findUnique({ where: { id: "school" } }),
  ]);
  if (!schoolIdentity) return res.status(503).json({ error: "Identité de l'établissement non initialisée" });
  const issues: string[] = [];
  const allAssessments = await prisma.assessment.findMany({
    where: { classId: schoolClass.id, periodId: period.id },
    include: { subject: true, teacher: { include: { person: true } }, marks: true },
  });
  for (const item of allAssessments) {
    if (item.status !== "VALIDEE") issues.push(`${schoolClass.name} : ${item.subject.label} (${item.teacher.person.nom}) n'est pas validée`);
    if (item.marks.some((mark) => mark.status === "NON_NOTE")) issues.push(`${item.title} : des élèves n'ont pas de note ou de statut`);
  }
  for (const program of programs) {
    if (!assessments.some((assessment) => assessment.subjectId === program.subjectId)) {
      issues.push(`${schoolClass.name} : ${program.subject.label} n'a aucune feuille validée`);
    }
    if (Number(program.coefficient) <= 0) {
      issues.push(`${schoolClass.name} : coefficient à compléter pour ${program.subject.label}`);
    }
    if (rule && rule.classworkWeight.toNumber() > 0 &&
        !assessments.some((item) => item.subjectId === program.subjectId && item.kind !== "COMPOSITION")) {
      issues.push(`${schoolClass.name} : contrôle continu non validé en ${program.subject.label}`);
    }
    if (rule && rule.compositionWeight.toNumber() > 0 &&
        !assessments.some((item) => item.subjectId === program.subjectId && item.kind === "COMPOSITION")) {
      issues.push(`${schoolClass.name} : composition non validée en ${program.subject.label}`);
    }
    const teacher = await prisma.teachingAssignment.findFirst({
      where: {
        classId: schoolClass.id,
        subjectId: program.subjectId,
        yearId: schoolClass.yearId,
        status: "EN_COURS",
        dateStart: { lte: period.dateEnd },
        OR: [{ dateEnd: null }, { dateEnd: { gte: period.dateStart } }],
      },
    });
    if (!teacher) issues.push(`${schoolClass.name} : aucun professeur affecté en ${program.subject.label}`);
  }
  if (enrollments.length !== appreciations.length) issues.push(`${schoolClass.name} : les appréciations du titulaire sont incomplètes`);
  if (!programs.length) issues.push(`${schoolClass.name} : le programme matière n'est pas configuré`);
  if (!rule) issues.push(`${schoolClass.name} : règle de calcul active manquante`);
  if (issues.length) return res.status(409).json({ error: "Bulletins bloqués par la checklist", issues });

  const weights = {
    classwork: Number(rule!.classworkWeight),
    composition: Number(rule!.compositionWeight),
    roundingDigits: rule!.roundingDigits,
  };
  const rows = enrollments.map(({ student }) => {
    const subjects = programs.map((program) => {
      const subjectAssessments = assessments.filter((item) => item.subjectId === program.subjectId);
      const classworkScores: number[] = [];
      const compositionScores: number[] = [];
      for (const assessment of subjectAssessments) {
        for (const mark of assessment.marks) {
          if (mark.studentId !== student.id || mark.status !== "NOTE" || mark.value === null) continue;
          const normalized = Number(mark.value) / Number(mark.scale) * 20;
          if (assessment.kind === "COMPOSITION") compositionScores.push(normalized);
          else classworkScores.push(normalized);
        }
      }
      return {
        subjectId: program.subjectId,
        label: program.subject.label,
        coefficient: Number(program.coefficient),
        classworkScores,
        compositionScores,
      };
    });
    const results = calculateSubjectAverages(subjects, weights);
    return {
      studentId: student.id,
      matricule: student.matricule,
      nom: student.person.nom,
      prenoms: student.person.prenoms,
      subjects: results,
      average: calculateWeightedAverage(results, weights.roundingDigits),
      appreciation: appreciations.find((item) => item.studentId === student.id)?.text ?? "",
    };
  });
  const ranked = assignCompetitionRanks(rows);
  const subjectRanks = new Map<string, Map<string, number | null>>();
  for (const program of programs) {
    const ranks = assignCompetitionRanks(rows.map((row) => ({
      studentId: row.studentId,
      average: row.subjects.find((subject) => subject.subjectId === program.subjectId)?.average ?? null,
    })));
    subjectRanks.set(program.subjectId, new Map(ranks.map((rank) => [rank.studentId, rank.rank])));
  }
  const evaluatedAverages = ranked.flatMap((row) => row.average === null ? [] : [row.average]);
  const classAverage = evaluatedAverages.length
    ? Number((evaluatedAverages.reduce((sum, value) => sum + value, 0) / evaluatedAverages.length).toFixed(weights.roundingDigits))
    : null;
  const snapshots = ranked.map((row) => ({
    ...row,
    subjects: row.subjects.map((subject) => ({
      ...subject,
      rank: subjectRanks.get(subject.subjectId)?.get(row.studentId) ?? null,
    })),
    classAverage,
    highest: evaluatedAverages.length ? Math.max(...evaluatedAverages) : null,
    lowest: evaluatedAverages.length ? Math.min(...evaluatedAverages) : null,
    enrollmentCount: enrollments.length,
    formulaVersion: rule!.version,
    generatedAt: new Date().toISOString(),
    schoolIdentity: {
      schoolName: schoolIdentity.schoolName,
      cycleSubtitle: schoolIdentity.cycleSubtitle,
      ministry: schoolIdentity.ministry,
      regionalDirectorate: schoolIdentity.regionalDirectorate,
      inspection: schoolIdentity.inspection,
      republicMotto: schoolIdentity.republicMotto,
      schoolMotto: schoolIdentity.schoolMotto,
      logoUrl: schoolIdentity.logoUrl,
    },
  }));
  try {
    const reportCards = await prisma.$transaction(snapshots.map((snapshot) =>
      prisma.reportCard.create({
        data: {
          studentId: snapshot.studentId,
          classId: schoolClass.id,
          yearId: schoolClass.yearId,
          periodId: period.id,
          ruleVersion: rule!.version,
          snapshot: snapshot as any,
          generatedBy: auth.sub,
        },
      }),
    ));
    await writeAudit({ userId: auth.sub, action: "REPORT_CARDS_GENERATE", entityType: "CLASS", entityId: schoolClass.id, newValue: { count: reportCards.length, ruleVersion: rule!.version }, req });
    res.status(201).json({ generated: reportCards.length, classAverage, ruleVersion: rule!.version });
  } catch (error: any) {
    if (error.code === "P2002") return res.status(409).json({ error: "Des bulletins existent déjà pour cette classe et cette période" });
    throw error;
  }
});

app.get("/api/report-cards", authenticate, requireRole(PersonRole.DIR, PersonRole.CEN, PersonRole.TIT), async (req, res) => {
  const auth = currentAuth(req);
  const classId = String(req.query.classId ?? "");
  if (!classId || !await canAccessClass(auth, classId)) return res.status(403).json({ error: "Classe obligatoire ou hors de votre portée" });
  const reportCards = await prisma.reportCard.findMany({
    where: {
      classId,
      ...(req.query.periodId ? { periodId: String(req.query.periodId) } : {}),
    },
    include: { student: { include: { person: true } }, period: true },
    orderBy: { student: { person: { nom: "asc" } } },
  });
  res.json(reportCards);
});

app.post("/api/report-cards/:id/approve", authenticate, requireRole(PersonRole.DIR), async (req, res) => {
  const auth = currentAuth(req);
  const id = String(req.params.id);
  const card = await prisma.reportCard.findUnique({ where: { id } });
  if (!card) return res.status(404).json({ error: "Bulletin introuvable" });
  if (card.generatedBy === auth.sub) return res.status(403).json({ error: "La direction ne peut pas valider un bulletin qu'elle a généré elle-même" });
  if (!await canAccessClass(auth, card.classId)) return res.status(403).json({ error: "Cette classe est hors de votre portée" });
  if (card.status !== "BROUILLON" && card.status !== "APPRECIATIONS") return res.status(409).json({ error: "Ce bulletin ne peut plus être validé dans son état actuel" });
  const approved = await prisma.reportCard.update({
    where: { id },
    data: { status: "FIGEE", approvedBy: auth.sub, approvedAt: new Date(), frozenAt: new Date() },
  });
  await writeAudit({ userId: auth.sub, action: "REPORT_CARD_FREEZE", entityType: "REPORT_CARD", entityId: id, req });
  res.json(approved);
});

app.post("/api/report-cards/:id/publish", authenticate, requireRole(PersonRole.DIR), async (req, res) => {
  const auth = currentAuth(req);
  const id = String(req.params.id);
  const card = await prisma.reportCard.findUnique({ where: { id } });
  if (!card) return res.status(404).json({ error: "Bulletin introuvable" });
  if (!await canAccessClass(auth, card.classId)) return res.status(403).json({ error: "Cette classe est hors de votre portée" });
  if (card.status !== "FIGEE") return res.status(409).json({ error: "Seul un bulletin figé peut être publié" });
  const published = await prisma.reportCard.update({ where: { id }, data: { status: "PUBLIEE" } });
  await writeAudit({ userId: auth.sub, action: "REPORT_CARD_PUBLISH", entityType: "REPORT_CARD", entityId: id, req });
  res.json(published);
});

app.use((error: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(error);
  res.status(500).json({ error: "Erreur interne du serveur" });
});

const port = Number(process.env.PORT ?? 4000);
app.listen(port, () => console.log(`API J1 démarrée sur http://localhost:${port}`));
