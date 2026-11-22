import { randomBytes } from "node:crypto";
import { Router, type Request, type RequestHandler } from "express";
import { PersonRole, PrismaClient, ScopeType } from "@prisma/client";
import { z } from "zod";

type AuthContext = {
  sub: string;
  personId: string;
  roles: { code: PersonRole; scopeType: ScopeType; scopeId?: string | null }[];
};

type DocumentsDependencies = {
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

const documentTypes = [
  "CERTIFICAT_SCOLARITE",
  "ATTESTATION_FREQUENTATION",
  "RELEVE_NOTES",
  "ATTESTATION_REUSSITE",
  "DUPLICATA_BULLETIN",
] as const;
const reportCardTypes = new Set(["RELEVE_NOTES", "ATTESTATION_REUSSITE", "DUPLICATA_BULLETIN"]);

function hasSchoolRole(auth: AuthContext, ...codes: PersonRole[]) {
  return auth.roles.some((role) =>
    codes.includes(role.code) &&
    role.scopeType === ScopeType.ETABLISSEMENT &&
    !role.scopeId,
  );
}

export function createDocumentsRouter(deps: DocumentsDependencies) {
  const { prisma, authenticate, requireRole, currentAuth, writeAudit } = deps;
  const router = Router();
  const documentAccess: RequestHandler[] = [
    requireRole(PersonRole.DIR, PersonRole.SEC),
    (req, res, next) => {
      if (!hasSchoolRole(currentAuth(req), PersonRole.DIR, PersonRole.SEC)) {
        return res.status(403).json({ error: "Accès réservé à la direction ou au secrétariat de l'établissement" });
      }
      next();
    },
  ];

  router.get("/official-documents", authenticate, ...documentAccess, async (req, res) => {
    const documents = await prisma.officialDocument.findMany({
      where: {
        ...(req.query.studentId ? { studentId: String(req.query.studentId) } : {}),
        ...(req.query.yearId ? { yearId: String(req.query.yearId) } : {}),
      },
      include: {
        student: { include: { person: true } },
        year: { select: { label: true } },
        reportCard: { select: { period: { select: { label: true } } } },
      },
      orderBy: { issuedAt: "desc" },
      take: 100,
    });
    res.json(documents);
  });

  router.get("/official-documents/candidates", authenticate, ...documentAccess, async (req, res) => {
    const parsed = z.object({
      studentId: z.string().uuid(),
      yearId: z.string().uuid(),
    }).safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: "Élève et année scolaire requis" });
    const enrollment = await prisma.enrollment.findUnique({
      where: { studentId_yearId: { studentId: parsed.data.studentId, yearId: parsed.data.yearId } },
      select: { status: true },
    });
    if (!enrollment || enrollment.status !== "ACTIVE") {
      return res.status(409).json({ error: "Aucune inscription active pour cette année" });
    }
    const reportCards = await prisma.reportCard.findMany({
      where: {
        studentId: parsed.data.studentId,
        yearId: parsed.data.yearId,
        status: "PUBLIEE",
      },
      select: { id: true, period: { select: { label: true } } },
      orderBy: { period: { dateStart: "asc" } },
    });
    res.json(reportCards);
  });

  router.post("/official-documents", authenticate, ...documentAccess, async (req, res) => {
    const parsed = z.object({
      studentId: z.string().uuid(),
      yearId: z.string().uuid(),
      type: z.enum(documentTypes),
      reportCardId: z.string().uuid().optional(),
    }).strict().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: z.prettifyError(parsed.error) });

    const { studentId, yearId, type, reportCardId } = parsed.data;
    const auth = currentAuth(req);
    if (type === "ATTESTATION_REUSSITE" && !hasSchoolRole(auth, PersonRole.DIR)) {
      return res.status(403).json({ error: "Une attestation de réussite doit être autorisée par la direction" });
    }
    const enrollment = await prisma.enrollment.findUnique({
      where: { studentId_yearId: { studentId, yearId } },
      include: {
        student: { include: { person: true } },
        year: { select: { dateStart: true } },
      },
    });
    if (!enrollment || enrollment.status !== "ACTIVE") {
      return res.status(409).json({ error: "Un document de scolarité exige une inscription active" });
    }
    const identity = await prisma.schoolIdentity.findUnique({ where: { id: "school" } });
    if (!identity) return res.status(503).json({ error: "Identité de l'établissement non initialisée" });

    let reportCard = null;
    if (reportCardTypes.has(type)) {
      if (!reportCardId) return res.status(400).json({ error: "Un bulletin publié est requis pour ce document" });
      reportCard = await prisma.reportCard.findFirst({
        where: { id: reportCardId, studentId, yearId, status: "PUBLIEE" },
        select: { id: true },
      });
      if (!reportCard) return res.status(409).json({ error: "Le bulletin doit être publié et correspondre à l'élève et à l'année" });
      if (type === "ATTESTATION_REUSSITE") {
        const decision = await prisma.councilDecision.findFirst({
          where: {
            studentId,
            decision: { in: ["PASSAGE", "ORIENTATION"] },
            meeting: { yearId, status: { in: ["TENU", "ARCHIVE"] } },
          },
          select: { id: true },
        });
        if (!decision) return res.status(409).json({ error: "Une décision de passage ou d'orientation validée est requise" });
      }
    } else if (reportCardId) {
      return res.status(400).json({ error: "Ce document ne doit pas référencer de bulletin" });
    }

    const year = enrollment.year.dateStart.getUTCFullYear();
    const document = await prisma.officialDocument.create({
      data: {
        number: `DOC-${year}-${randomBytes(5).toString("hex").toUpperCase()}`,
        verificationToken: randomBytes(32).toString("base64url"),
        type,
        specimen: enrollment.student.isDemo,
        identitySnapshot: {
          schoolName: identity.schoolName,
          shortName: identity.shortName,
          monogram: identity.monogram,
          cycleSubtitle: identity.cycleSubtitle,
          ministry: identity.ministry,
          regionalDirectorate: identity.regionalDirectorate,
          inspection: identity.inspection,
          republicName: identity.republicName,
          republicMotto: identity.republicMotto,
          schoolMotto: identity.schoolMotto,
          address: identity.address,
          logoUrl: identity.logoUrl,
          logoVersionId: identity.logoVersionId,
          identityVersion: identity.version,
        },
        studentId,
        yearId,
        reportCardId: reportCard?.id,
        issuedBy: auth.sub,
      },
      include: {
        student: { include: { person: true } },
        year: { select: { label: true } },
        reportCard: { select: { period: { select: { label: true } } } },
      },
    });
    await writeAudit({
      userId: auth.sub,
      action: "OFFICIAL_DOCUMENT_ISSUE",
      entityType: "OFFICIAL_DOCUMENT",
      entityId: document.id,
      newValue: { number: document.number, type, studentId, yearId, reportCardId: reportCard?.id ?? null },
      req,
    });
    res.status(201).json(document);
  });

  router.post("/official-documents/:id/revoke", authenticate, requireRole(PersonRole.DIR), async (req, res) => {
    const auth = currentAuth(req);
    if (!hasSchoolRole(auth, PersonRole.DIR)) {
      return res.status(403).json({ error: "Annulation réservée à la direction de l'établissement" });
    }
    const parsed = z.object({ reason: z.string().trim().min(5).max(500) }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Un motif d'au moins 5 caractères est requis" });
    const id = String(req.params.id);
    const document = await prisma.officialDocument.findUnique({ where: { id } });
    if (!document) return res.status(404).json({ error: "Document introuvable" });
    if (document.revokedAt) return res.status(409).json({ error: "Ce document est déjà annulé" });
    const revoked = await prisma.officialDocument.update({
      where: { id },
      data: { revokedAt: new Date(), revokeReason: parsed.data.reason },
    });
    await writeAudit({
      userId: auth.sub,
      action: "OFFICIAL_DOCUMENT_REVOKE",
      entityType: "OFFICIAL_DOCUMENT",
      entityId: id,
      oldValue: { revokedAt: null },
      newValue: { revokedAt: revoked.revokedAt, reason: parsed.data.reason },
      reason: parsed.data.reason,
      req,
    });
    res.json(revoked);
  });

  return router;
}
