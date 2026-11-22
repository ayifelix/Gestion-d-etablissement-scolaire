import assert from "node:assert/strict";
import { once } from "node:events";
import express, { type Request, type RequestHandler } from "express";
import { AddressInfo } from "node:net";
import test from "node:test";
import { PersonRole, PrismaClient, ScopeType } from "@prisma/client";
import { createDocumentsRouter } from "../src/documents";

test("les documents officiels exigent une portée établissement, un bulletin publié et une annulation tracée", async (t) => {
  const audits: Array<{ action: string; entityType: string; reason?: string }> = [];
  let document: Record<string, any> | null = null;
  const student = {
    matricule: "DEMO-001",
    isDemo: true,
    person: { nom: "Nom fictif", prenoms: "Élève démo" },
  };
  const prisma = {
    schoolIdentity: {
      findUnique: async () => ({
        schoolName: "LYCÉE AKONDA GNAWEME",
        shortName: "Akonda",
        monogram: "AG",
        cycleSubtitle: "Collège et Lycée",
        ministry: "MEPS",
        regionalDirectorate: "DRE-Maritime",
        inspection: "IESG-Vogan",
        republicName: "République Togolaise",
        republicMotto: "Travail - Liberté - Patrie",
        schoolMotto: "Discipline - Travail - Succès",
        address: "",
        logoUrl: "/assets/etablissement/logo-128.webp",
        logoVersionId: "logo-v1",
        version: 1,
      }),
    },
    enrollment: {
      findUnique: async () => ({ status: "ACTIVE", student, year: { dateStart: new Date("2026-09-01T00:00:00Z") } }),
    },
    reportCard: {
      findFirst: async ({ where }: { where: { id: string } }) =>
        where.id.endsWith("0001") ? { id: where.id } : null,
      findMany: async () => [{ id: "published-card", period: { label: "Trimestre 1" } }],
    },
    councilDecision: {
      findFirst: async () => null,
    },
    officialDocument: {
      findMany: async () => document ? [document] : [],
      findUnique: async () => document,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        document = {
          id: "doc-id",
          ...data,
          issuedAt: new Date("2026-11-21T12:00:00Z"),
          revokedAt: null,
          student,
          year: { label: "2026-2027" },
          reportCard: null,
        };
        return document;
      },
      update: async ({ data }: { data: Record<string, unknown> }) => {
        document = { ...document, ...data };
        return document;
      },
    },
  };
  const authenticate: RequestHandler = (_req, _res, next) => next();
  const app = express();
  app.use(express.json());
  const currentAuth = (req: Request) => {
    const role = req.get("x-role") ?? "DIR";
    const scope = req.get("x-scope") ?? "ETABLISSEMENT";
    return {
      sub: req.get("x-user") ?? "direction",
      personId: "person-id",
      roles: [{ code: role as PersonRole, scopeType: scope as ScopeType, scopeId: null }],
    };
  };
  app.use("/api", createDocumentsRouter({
    prisma: prisma as unknown as PrismaClient,
    authenticate,
    currentAuth,
    requireRole: (...codes) => (req, res, next) =>
      codes.includes(currentAuth(req).roles[0].code) ? next() : res.status(403).json({ error: "Accès refusé" }),
    writeAudit: async (entry) => {
      audits.push({ action: entry.action, entityType: entry.entityType, reason: entry.reason });
    },
  }));
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  }));
  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}/api/official-documents`;
  const request = (path: string, role = "DIR", scope = "ETABLISSEMENT", init: RequestInit = {}) =>
    fetch(`${baseUrl}${path}`, {
      ...init,
      headers: {
        "x-role": role,
        "x-scope": scope,
        ...(init.body ? { "content-type": "application/json" } : {}),
        ...init.headers,
      },
    });
  const studentId = "10000000-0000-4000-8000-000000000001";
  const yearId = "20000000-0000-4000-8000-000000000001";
  const publishedCardId = "30000000-0000-4000-8000-000000000001";
  const draftCardId = "30000000-0000-4000-8000-000000000002";

  const deniedScope = await request("", "SEC", "CYCLE", { method: "GET" });
  assert.equal(deniedScope.status, 403);
  const unpublished = await request("", "SEC", "ETABLISSEMENT", {
    method: "POST",
    body: JSON.stringify({ studentId, yearId, type: "RELEVE_NOTES", reportCardId: draftCardId }),
  });
  assert.equal(unpublished.status, 409);
  const successRequired = await request("", "SEC", "ETABLISSEMENT", {
    method: "POST",
    body: JSON.stringify({ studentId, yearId, type: "ATTESTATION_REUSSITE", reportCardId: publishedCardId }),
  });
  assert.equal(successRequired.status, 403);
  const noPassDecision = await request("", "DIR", "ETABLISSEMENT", {
    method: "POST",
    body: JSON.stringify({ studentId, yearId, type: "ATTESTATION_REUSSITE", reportCardId: publishedCardId }),
  });
  assert.equal(noPassDecision.status, 409);

  const created = await request("", "SEC", "ETABLISSEMENT", {
    method: "POST",
    body: JSON.stringify({ studentId, yearId, type: "CERTIFICAT_SCOLARITE" }),
  });
  assert.equal(created.status, 201);
  const issued = await created.json() as { number: string; verificationToken: string };
  assert.match(issued.number, /^DOC-2026-[0-9A-F]{10}$/);
  assert.ok(issued.verificationToken.length >= 40);
  const storedDocument = document as Record<string, unknown> | null;
  assert.equal(storedDocument?.specimen, true);
  assert.equal((storedDocument?.identitySnapshot as Record<string, unknown>).logoVersionId, "logo-v1");
  assert.equal(audits[0].action, "OFFICIAL_DOCUMENT_ISSUE");

  const revoked = await request("/doc-id/revoke", "DIR", "ETABLISSEMENT", {
    method: "POST",
    body: JSON.stringify({ reason: "Duplicata demandé" }),
  });
  assert.equal(revoked.status, 200);
  assert.equal(audits[1].action, "OFFICIAL_DOCUMENT_REVOKE");
  assert.equal(audits[1].reason, "Duplicata demandé");
  const secondRevocation = await request("/doc-id/revoke", "DIR", "ETABLISSEMENT", {
    method: "POST",
    body: JSON.stringify({ reason: "Nouvelle tentative" }),
  });
  assert.equal(secondRevocation.status, 409);
});
