import assert from "node:assert/strict";
import { once } from "node:events";
import express, { type Request, type RequestHandler } from "express";
import { AddressInfo } from "node:net";
import test from "node:test";
import { PrismaClient } from "@prisma/client";
import { createSiteRouter } from "../src/site";

test("les routes publiques exposent des champs minimaux et le contenu est réservé à la direction", async (t) => {
  const identity: Record<string, unknown> = {
    id: "school",
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
    phone: "",
    email: "",
    secretariatHours: "",
    headName: "",
    headMessage: "",
    collegePresentation: "",
    lyceePresentation: "",
    directionsUrl: "",
    logoUrl: null,
    compactLogoUrl: null,
    logoVersionId: null,
    photoUrl: null,
    version: 1,
    privateInternalField: "ne doit pas être publié",
  };
  const announcements = [{
    id: "event-1",
    title: "Rentrée",
    summary: "Accueil des élèves",
    category: "RENTREE",
    eventAt: null,
    createdBy: "private-user-id",
  }];
  const audits: Array<{ action: string; entityType: string; userId?: string }> = [];
  const identityVersions: Array<Record<string, unknown>> = [];
  const requestedPermissions: string[] = [];
  let prismaReference: unknown;
  const prisma = {
    schoolIdentity: {
      findUnique: async () => ({ ...identity }),
      upsert: async ({ update }: { update: Record<string, unknown> }) => {
        const changes = { ...update };
        if (typeof changes.version === "object") changes.version = Number(identity.version) + 1;
        Object.assign(identity, changes);
        return { ...identity };
      },
    },
    schoolIdentityVersion: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const created = { id: `version-${identityVersions.length + 1}`, createdAt: new Date(), ...data };
        identityVersions.push(created);
        return created;
      },
      findMany: async () => [...identityVersions].reverse(),
      findUnique: async ({ where }: { where: { id: string } }) =>
        identityVersions.find((version) => version.id === where.id) ?? null,
    },
    $transaction: async (callback: (transaction: unknown) => Promise<unknown>) => callback(prismaReference),
    publicAnnouncement: {
      findMany: async () => announcements.map(({ id, title, summary, category, eventAt }) =>
        ({ id, title, summary, category, eventAt })),
    },
    userRole: {
      findFirst: async ({ where }: {
        where: { userId: string; scopeType: string; scopeId: null; role: { code: string; permissions: { some: { permission: { code: string } } } } };
      }) => where.userId === "direction" &&
        where.scopeType === "ETABLISSEMENT" &&
        where.scopeId === null &&
        where.role.code === "DIR"
        ? (requestedPermissions.push(where.role.permissions.some.permission.code), { id: "active-direction-role" })
        : null,
    },
    schoolPayment: {
      findFirst: async ({ where }: { where: { OR: Array<Record<string, string>> } }) => {
        const code = where.OR[0].receiptNumber ?? where.OR[1].qrToken;
        if (code === "VALID") return { receiptNumber: "REC-2026-01", reversal: null, student: { name: "Donnée privée" } };
        if (code === "CANCEL") return { receiptNumber: "REC-2026-02", reversal: { id: "reversal" }, student: { name: "Donnée privée" } };
        return null;
      },
    },
    officialDocument: {
      findFirst: async ({ where }: { where: { OR: Array<Record<string, string>> } }) => {
        const code = where.OR[0].number ?? where.OR[1].verificationToken;
        if (code === "DOCVALID") return { number: "DOC-2026-AB12", type: "CERTIFICAT_SCOLARITE", revokedAt: null };
        if (code === "DOCCANCEL") return { number: "DOC-2026-CD34", type: "RELEVE_NOTES", revokedAt: new Date() };
        return null;
      },
    },
  };
  prismaReference = prisma;
  const authenticate: RequestHandler = (_req, _res, next) => next();
  const app = express();
  app.use(express.json());
  app.use("/api", createSiteRouter({
    prisma: prisma as unknown as PrismaClient,
    authenticate,
    currentAuth: (req: Request) => ({ sub: req.get("x-user") ?? "direction", personId: "person", roles: [] }),
    writeAudit: async (entry) => {
      audits.push({ action: entry.action, entityType: entry.entityType, userId: entry.userId });
    },
  }));
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  }));
  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}/api`;
  const request = (pathname: string, user = "direction", init: RequestInit = {}) =>
    fetch(`${baseUrl}${pathname}`, {
      ...init,
      headers: { "x-user": user, ...(init.body ? { "content-type": "application/json" } : {}), ...init.headers },
    });

  const publicSiteResponse = await request("/public/site");
  assert.equal(publicSiteResponse.status, 200);
  assert.equal(publicSiteResponse.headers.get("cache-control"), "no-store");
  const publicSite = await publicSiteResponse.json() as { identity: Record<string, unknown>; announcements: Array<Record<string, unknown>> };
  assert.equal(publicSite.identity.schoolName, "LYCÉE AKONDA GNAWEME");
  assert.equal("privateInternalField" in publicSite.identity, false);
  assert.equal("createdBy" in publicSite.announcements[0], false);
  assert.equal((await request("/site-content")).status, 200);

  for (const [code, status, type, reference] of [
    ["VALID", "AUTHENTIQUE", "RECU", "REC-2026-01"],
    ["CANCEL", "ANNULE", "RECU", "REC-2026-02"],
    ["DOCVALID", "AUTHENTIQUE", "CERTIFICAT_SCOLARITE", "DOC-2026-AB12"],
    ["DOCCANCEL", "ANNULE", "RELEVE_NOTES", "DOC-2026-CD34"],
    ["MISS", "INTROUVABLE", null, null],
  ]) {
    const response = await request(`/public/verify?code=${code}`);
    assert.equal(response.headers.get("cache-control"), "no-store");
    const result = await response.json() as Record<string, unknown>;
    assert.equal(result.status, status);
    assert.equal(result.type, type);
    assert.equal(result.reference, reference);
    assert.deepEqual(Object.keys(result).sort(), ["reference", "status", "type"]);
    assert.equal("student" in result, false);
  }
  for (let index = 0; index < 3; index += 1) {
    assert.equal((await request(`/public/verify?code=MISS${index}`)).status, 200);
  }
  const limitedResponse = await request("/public/verify?code=LAST");
  assert.equal(limitedResponse.status, 429);
  assert.equal((await limitedResponse.json()).error, "Trop de vérifications. Réessayez plus tard.");

  const deniedUsers = ["admin", "censor", "secretary", "finance", "teacher", "tutor", "parent", "student", "verifier"];
  for (const user of deniedUsers) {
    const response = await request("/site-content/identity", user, {
      method: "PUT",
      body: JSON.stringify({ schoolName: "Nom non autorisé" }),
    });
    assert.equal(response.status, 403, `${user} doit être refusé`);
    assert.equal((await request("/school-identity", user)).status, 403, `${user} ne peut pas lire l'écran d'identité`);
  }
  assert.ok(requestedPermissions.includes("site.gerer_contenu"));
  assert.equal((await request("/school-identity", "direction")).status, 200);
  const updateResponse = await request("/site-content/identity", "direction", {
    method: "PUT",
    body: JSON.stringify({ schoolName: "Nom modifié" }),
  });
  assert.equal(updateResponse.status, 200);
  assert.equal(identity.version, 2);
  assert.equal(identityVersions.length, 1);
  assert.deepEqual(audits.map(({ action, entityType, userId }) => ({ action, entityType, userId })), [{
    action: "SITE_IDENTITY_UPDATE",
    entityType: "SCHOOL_IDENTITY",
    userId: "direction",
  }]);
});
