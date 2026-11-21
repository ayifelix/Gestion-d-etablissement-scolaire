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
    cycleSubtitle: "Collège et Lycée",
    ministry: "MEPS",
    regionalDirectorate: "DRE-Maritime",
    inspection: "IESG-Vogan",
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
    photoUrl: null,
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
  const prisma = {
    schoolIdentity: {
      findUnique: async () => ({ ...identity }),
      upsert: async ({ update }: { update: Record<string, unknown> }) => {
        Object.assign(identity, update);
        return { ...identity };
      },
    },
    publicAnnouncement: {
      findMany: async () => announcements.map(({ id, title, summary, category, eventAt }) =>
        ({ id, title, summary, category, eventAt })),
    },
    userRole: {
      findFirst: async ({ where }: {
        where: { userId: string; scopeType: string; scopeId: null; role: { code: string } };
      }) => where.userId === "direction" &&
        where.scopeType === "ETABLISSEMENT" &&
        where.scopeId === null &&
        where.role.code === "DIR"
        ? { id: "active-direction-role" }
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
  };
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

  for (const [code, status] of [["VALID", "AUTHENTIQUE"], ["CANCEL", "ANNULE"], ["MISS", "INTROUVABLE"]]) {
    const response = await request(`/public/verify?code=${code}`);
    assert.equal(response.headers.get("cache-control"), "no-store");
    const result = await response.json() as Record<string, unknown>;
    assert.equal(result.status, status);
    assert.deepEqual(Object.keys(result).sort(), ["reference", "status", "type"]);
    assert.equal("student" in result, false);
  }
  for (let index = 0; index < 5; index += 1) {
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
  }
  const updateResponse = await request("/site-content/identity", "direction", {
    method: "PUT",
    body: JSON.stringify({ schoolName: "Nom modifié" }),
  });
  assert.equal(updateResponse.status, 200);
  assert.deepEqual(audits.map(({ action, entityType, userId }) => ({ action, entityType, userId })), [{
    action: "SITE_IDENTITY_UPDATE",
    entityType: "SCHOOL_IDENTITY",
    userId: "direction",
  }]);
});
