import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { Router, type Request, type RequestHandler } from "express";
import rateLimit from "express-rate-limit";
import multer from "multer";
import { PersonRole, Prisma, PrismaClient, SchoolIdentity, ScopeType } from "@prisma/client";
import sharp from "sharp";
import { z } from "zod";

type AuthContext = {
  sub: string;
  personId: string;
  roles: { code: PersonRole; scopeType: ScopeType; scopeId?: string | null }[];
};

type SiteDependencies = {
  prisma: PrismaClient;
  authenticate: RequestHandler;
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

const mediaDirectory = path.resolve(__dirname, "../uploads");
const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
});

const identitySchema = z.object({
  schoolName: z.string().trim().min(2).max(160).optional(),
  shortName: z.string().trim().min(1).max(80).optional(),
  monogram: z.string().trim().min(1).max(8).optional(),
  cycleSubtitle: z.string().trim().min(2).max(120).optional(),
  ministry: z.string().trim().max(180).optional(),
  regionalDirectorate: z.string().trim().max(120).optional(),
  inspection: z.string().trim().max(120).optional(),
  republicName: z.string().trim().max(120).optional(),
  republicMotto: z.string().trim().max(120).optional(),
  schoolMotto: z.string().trim().max(120).optional(),
  address: z.string().trim().max(500).optional(),
  phone: z.string().trim().max(80).optional(),
  email: z.string().trim().max(254).email().or(z.literal("")).optional(),
  secretariatHours: z.string().trim().max(200).optional(),
  headName: z.string().trim().max(160).optional(),
  headMessage: z.string().trim().max(3000).optional(),
  collegePresentation: z.string().trim().max(3000).optional(),
  lyceePresentation: z.string().trim().max(3000).optional(),
  directionsUrl: z.string().trim().max(500).url().or(z.literal("")).optional(),
});

const announcementCategories = [
  "RENTREE",
  "COMPOSITIONS",
  "CONSEIL",
  "EXAMEN_BLANC_BEPC",
  "EXAMEN_BLANC_BAC_I",
  "EXAMEN_BLANC_BAC_II",
  "REMISE_BULLETINS",
  "AUTRE",
] as const;

const announcementSchema = z.object({
  title: z.string().trim().min(3).max(160),
  summary: z.string().trim().min(3).max(1200),
  category: z.enum(announcementCategories),
  eventAt: z.string().datetime({ offset: true }).nullable().optional()
    .transform((value) => value ? new Date(value) : null),
  published: z.boolean().default(false),
});

const announcementUpdateSchema = announcementSchema.partial();

function imageExtension(file: Express.Multer.File) {
  const buffer = file.buffer;
  if (file.mimetype === "image/png" &&
      buffer.length >= 8 &&
      buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return ".png";
  if (file.mimetype === "image/jpeg" &&
      buffer.length >= 3 &&
      buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return ".jpg";
  if (file.mimetype === "image/webp" &&
      buffer.length >= 12 &&
      buffer.toString("ascii", 0, 4) === "RIFF" &&
      buffer.toString("ascii", 8, 12) === "WEBP") return ".webp";
  return null;
}

export function createSiteRouter(deps: SiteDependencies) {
  const { prisma, authenticate, currentAuth, writeAudit } = deps;
  const router = Router();

  const verifyLimit = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 8,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Trop de vérifications. Réessayez plus tard." },
  });

  const manageContent: RequestHandler = async (req, res, next) => {
    const now = new Date();
    const granted = await prisma.userRole.findFirst({
      where: {
        userId: currentAuth(req).sub,
        scopeType: ScopeType.ETABLISSEMENT,
        scopeId: null,
        dateStart: { lte: now },
        OR: [{ dateEnd: null }, { dateEnd: { gte: now } }],
        role: {
          code: PersonRole.DIR,
          permissions: {
            some: { permission: { code: "site.gerer_contenu" } },
          },
        },
      },
    });
    if (!granted) return res.status(403).json({ error: "Permission site.gerer_contenu requise" });
    next();
  };

  const manageIdentity: RequestHandler = async (req, res, next) => {
    const now = new Date();
    const granted = await prisma.userRole.findFirst({
      where: {
        userId: currentAuth(req).sub,
        scopeType: ScopeType.ETABLISSEMENT,
        scopeId: null,
        dateStart: { lte: now },
        OR: [{ dateEnd: null }, { dateEnd: { gte: now } }],
        role: {
          code: PersonRole.DIR,
          permissions: {
            some: { permission: { code: "etablissement.gerer_identite" } },
          },
        },
      },
    });
    if (!granted) return res.status(403).json({ error: "Permission etablissement.gerer_identite requise" });
    next();
  };

  const identitySnapshot = (identity: SchoolIdentity): Prisma.InputJsonObject => ({
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
    phone: identity.phone,
    email: identity.email,
    secretariatHours: identity.secretariatHours,
    headName: identity.headName,
    headMessage: identity.headMessage,
    collegePresentation: identity.collegePresentation,
    lyceePresentation: identity.lyceePresentation,
    directionsUrl: identity.directionsUrl,
    logoUrl: identity.logoUrl,
    compactLogoUrl: identity.compactLogoUrl,
    logoVersionId: identity.logoVersionId,
    photoUrl: identity.photoUrl,
    version: identity.version,
  });

  async function getIdentity() {
    return prisma.schoolIdentity.findUnique({ where: { id: "school" } });
  }

  router.get("/public/site", async (_req, res) => {
    const [identity, announcements, gallery] = await Promise.all([
      getIdentity(),
      prisma.publicAnnouncement.findMany({
        where: {
          published: true,
          archivedAt: null,
          OR: [{ eventAt: null }, { eventAt: { gte: new Date() } }],
        },
        orderBy: [{ eventAt: "asc" }, { createdAt: "desc" }],
        take: 12,
        select: { id: true, title: true, summary: true, category: true, eventAt: true },
      }),
      (prisma as PrismaClient & { schoolGalleryPhoto?: { findMany: (args: unknown) => Promise<Array<{ id: string; url: string; lowUrl: string | null; alt: string; label: string; position: string }>> } }).schoolGalleryPhoto?.findMany({
        where: { active: true },
        orderBy: [{ order: "asc" }, { createdAt: "asc" }],
        select: { id: true, url: true, lowUrl: true, alt: true, label: true, position: true },
      }) ?? [],
    ]);
    if (!identity) return res.status(503).json({ error: "Identité de l'établissement non initialisée" });
    res.setHeader("Cache-Control", "no-store");
    res.json({
      identity: {
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
        phone: identity.phone,
        email: identity.email,
        secretariatHours: identity.secretariatHours,
        headName: identity.headName,
        headMessage: identity.headMessage,
        collegePresentation: identity.collegePresentation,
        lyceePresentation: identity.lyceePresentation,
        directionsUrl: identity.directionsUrl,
        logoUrl: identity.logoUrl,
        photoUrl: identity.photoUrl,
      },
      announcements,
      gallery,
    });
  });

  router.get("/public/verify", verifyLimit, async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const parsed = z.string().trim().min(4).max(120).safeParse(req.query.code);
    if (!parsed.success) {
      return res.status(200).json({ status: "INTROUVABLE", type: null, reference: null });
    }
    const code = parsed.data;
    const payment = await prisma.schoolPayment.findFirst({
      where: { OR: [{ receiptNumber: code }, { qrToken: code }] },
      select: { receiptNumber: true, reversal: { select: { id: true } } },
    });
    if (payment) {
      return res.json({
        status: payment.reversal ? "ANNULE" : "AUTHENTIQUE",
        type: "RECU",
        reference: payment.receiptNumber,
      });
    }
    const document = await prisma.officialDocument.findFirst({
      where: { OR: [{ number: code }, { verificationToken: code }] },
      select: { number: true, type: true, revokedAt: true },
    });
    res.json({
      status: !document ? "INTROUVABLE" : document.revokedAt ? "ANNULE" : "AUTHENTIQUE",
      type: document?.type ?? null,
      reference: document?.number ?? null,
    });
  });

  router.get("/public/media/:filename", async (req, res) => {
    const filename = String(req.params.filename);
    if (!/^[0-9a-f-]{36}(?:-original|-(?:64|128|256|512|1024))?\.(png|jpg|webp)$/.test(filename)) {
      return res.status(404).json({ error: "Image introuvable" });
    }
    res.sendFile(path.join(mediaDirectory, filename), (error) => {
      if (error && !res.headersSent) res.status(404).json({ error: "Image introuvable" });
    });
  });

  router.get("/site-content", authenticate, manageContent, async (_req, res) => {
    const [identity, announcements, gallery] = await Promise.all([
      getIdentity(),
      prisma.publicAnnouncement.findMany({
        where: { archivedAt: null },
        orderBy: [{ eventAt: "asc" }, { createdAt: "desc" }],
      }),
      (prisma as PrismaClient & { schoolGalleryPhoto?: { findMany: (args: unknown) => Promise<unknown[]> } }).schoolGalleryPhoto?.findMany({
        orderBy: [{ order: "asc" }, { createdAt: "asc" }],
      }) ?? [],
    ]);
    if (!identity) return res.status(503).json({ error: "Identité de l'établissement non initialisée" });
    res.json({ identity, announcements, gallery });
  });

  router.get("/school-identity", authenticate, manageIdentity, async (_req, res) => {
    const identity = await getIdentity();
    if (!identity) return res.status(503).json({ error: "Identité de l'établissement non initialisée" });
    res.json(identity);
  });

  router.get("/school-identity/versions", authenticate, manageIdentity, async (_req, res) => {
    const identity = await getIdentity();
    if (!identity) return res.status(503).json({ error: "Identité de l'établissement non initialisée" });
    const versions = await prisma.schoolIdentityVersion.findMany({
      where: { schoolIdentityId: identity.id },
      orderBy: { version: "desc" },
      select: { id: true, version: true, createdAt: true, createdBy: true },
    });
    res.json(versions);
  });

  router.put("/site-content/identity", authenticate, manageIdentity, async (req, res) => {
    const parsed = identitySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: z.prettifyError(parsed.error) });
    const userId = currentAuth(req).sub;
    const previous = await getIdentity();
    const identity = await prisma.$transaction(async (transaction) => {
      const saved = await transaction.schoolIdentity.upsert({
        where: { id: "school" },
        create: { id: "school", ...parsed.data, updatedBy: userId },
        update: { ...parsed.data, version: { increment: 1 }, updatedBy: userId },
      });
      await transaction.schoolIdentityVersion.create({
        data: {
          schoolIdentityId: saved.id,
          version: saved.version,
          snapshot: identitySnapshot(saved),
          createdBy: userId,
        },
      });
      return saved;
    });
    await writeAudit({
      userId,
      action: "SITE_IDENTITY_UPDATE",
      entityType: "SCHOOL_IDENTITY",
      entityId: identity.id,
      oldValue: previous,
      newValue: parsed.data,
      req,
    });
    res.json(identity);
  });

  router.post("/school-identity/versions/:id/restore", authenticate, manageIdentity, async (req, res) => {
    const version = await prisma.schoolIdentityVersion.findUnique({ where: { id: String(req.params.id) } });
    if (!version) return res.status(404).json({ error: "Version d'identité introuvable" });
    const parsed = identitySchema.safeParse(version.snapshot);
    const mediaSnapshot = z.object({
      logoUrl: z.string().nullable().optional(),
      compactLogoUrl: z.string().nullable().optional(),
      logoVersionId: z.string().nullable().optional(),
      photoUrl: z.string().nullable().optional(),
    }).safeParse(version.snapshot);
    if (!parsed.success || !mediaSnapshot.success) {
      return res.status(409).json({ error: "Cette version ne peut pas être restaurée" });
    }
    const userId = currentAuth(req).sub;
    const previous = await getIdentity();
    if (!previous) return res.status(503).json({ error: "Identité de l'établissement non initialisée" });
    const identity = await prisma.$transaction(async (transaction) => {
      const restored = await transaction.schoolIdentity.update({
        where: { id: previous.id },
        data: { ...parsed.data, ...mediaSnapshot.data, version: { increment: 1 }, updatedBy: userId },
      });
      await transaction.schoolIdentityVersion.create({
        data: {
          schoolIdentityId: restored.id,
          version: restored.version,
          snapshot: identitySnapshot(restored),
          createdBy: userId,
        },
      });
      return restored;
    });
    await writeAudit({
      userId,
      action: "SCHOOL_IDENTITY_RESTORE",
      entityType: "SCHOOL_IDENTITY",
      entityId: identity.id,
      oldValue: previous,
      newValue: identity,
      reason: `Restauration de la version ${version.version}`,
      req,
    });
    res.json(identity);
  });

  router.post("/site-content/announcements", authenticate, manageContent, async (req, res) => {
    const parsed = announcementSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: z.prettifyError(parsed.error) });
    const userId = currentAuth(req).sub;
    const announcement = await prisma.publicAnnouncement.create({
      data: { ...parsed.data, createdBy: userId, updatedBy: userId },
    });
    await writeAudit({
      userId,
      action: "SITE_ANNOUNCEMENT_CREATE",
      entityType: "PUBLIC_ANNOUNCEMENT",
      entityId: announcement.id,
      newValue: announcement,
      req,
    });
    res.status(201).json(announcement);
  });

  router.put("/site-content/announcements/:id", authenticate, manageContent, async (req, res) => {
    const parsed = announcementUpdateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: z.prettifyError(parsed.error) });
    const id = String(req.params.id);
    const previous = await prisma.publicAnnouncement.findFirst({ where: { id, archivedAt: null } });
    if (!previous) return res.status(404).json({ error: "Annonce introuvable" });
    const announcement = await prisma.publicAnnouncement.update({
      where: { id },
      data: { ...parsed.data, updatedBy: currentAuth(req).sub },
    });
    await writeAudit({
      userId: currentAuth(req).sub,
      action: "SITE_ANNOUNCEMENT_UPDATE",
      entityType: "PUBLIC_ANNOUNCEMENT",
      entityId: id,
      oldValue: previous,
      newValue: announcement,
      req,
    });
    res.json(announcement);
  });

  router.delete("/site-content/announcements/:id", authenticate, manageContent, async (req, res) => {
    const id = String(req.params.id);
    const previous = await prisma.publicAnnouncement.findFirst({ where: { id, archivedAt: null } });
    if (!previous) return res.status(404).json({ error: "Annonce introuvable" });
    const archived = await prisma.publicAnnouncement.update({
      where: { id },
      data: { published: false, archivedAt: new Date(), updatedBy: currentAuth(req).sub },
    });
    await writeAudit({
      userId: currentAuth(req).sub,
      action: "SITE_ANNOUNCEMENT_ARCHIVE",
      entityType: "PUBLIC_ANNOUNCEMENT",
      entityId: id,
      oldValue: previous,
      newValue: archived,
      req,
    });
    res.status(204).end();
  });

  router.post(
    "/site-content/media",
    authenticate,
    manageContent,
    (req, res, next) => imageUpload.single("image")(req, res, (error) => {
      if (!error) return next();
      const message = error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE"
        ? "L'image dépasse la limite de 5 Mo"
        : "Image invalide";
      res.status(400).json({ error: message });
    }),
    async (req, res) => {
      const file = req.file;
      const kind = req.body.kind;
      if (!file || !["photo", "gallery"].includes(kind)) {
        return res.status(400).json({ error: "Une photo d'établissement est requise" });
      }
      const extension = imageExtension(file);
      if (!extension) return res.status(400).json({ error: "Formats acceptés : PNG, JPEG ou WebP valide" });
      const filename = `${randomUUID()}${extension}`;
      await mkdir(mediaDirectory, { recursive: true });
      await writeFile(path.join(mediaDirectory, filename), file.buffer, { flag: "wx" });
      const url = `/api/public/media/${filename}`;
      if (kind === "gallery") {
        const userId = currentAuth(req).sub;
        const galleryCount = await prisma.schoolGalleryPhoto.count();
        const photo = await prisma.schoolGalleryPhoto.create({
          data: {
            url,
            lowUrl: url,
            alt: "Vue de l'établissement",
            label: "Vie scolaire",
            position: "50% 50%",
            order: galleryCount,
          },
        });
        await writeAudit({
          userId,
          action: "SITE_GALLERY_PHOTO_CREATE",
          entityType: "SCHOOL_GALLERY_PHOTO",
          entityId: photo.id,
          newValue: photo,
          req,
        });
        return res.status(201).json({ kind, url, photo });
      }
      const field = "photoUrl";
      const userId = currentAuth(req).sub;
      const previous = await getIdentity();
      const identity = await prisma.schoolIdentity.upsert({
        where: { id: "school" },
        create: { id: "school", [field]: url, updatedBy: userId },
        update: { [field]: url, updatedBy: userId },
      });
      await writeAudit({
        userId,
        action: "SITE_MEDIA_UPDATE",
        entityType: "SCHOOL_IDENTITY",
        entityId: identity.id,
        oldValue: { [field]: previous?.[field] ?? null },
        newValue: { [field]: url },
        req,
      });
      res.status(201).json({ kind, url });
    },
  );

  router.put("/site-content/gallery/:id", authenticate, manageContent, async (req, res) => {
    const parsed = z.object({
      label: z.string().trim().min(2).max(120).optional(),
      alt: z.string().trim().min(2).max(240).optional(),
      position: z.string().trim().regex(/^(?:left|center|right|\d+(?:\.\d+)?)%\s+(?:top|center|bottom|\d+(?:\.\d+)?)%$/, "Point focal invalide").optional(),
      active: z.boolean().optional(),
      order: z.number().int().min(0).optional(),
    }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: z.prettifyError(parsed.error) });
    const previous = await prisma.schoolGalleryPhoto.findUnique({ where: { id: String(req.params.id) } });
    if (!previous) return res.status(404).json({ error: "Photo introuvable" });
    const photo = await prisma.schoolGalleryPhoto.update({ where: { id: previous.id }, data: parsed.data });
    await writeAudit({
      userId: currentAuth(req).sub,
      action: "SITE_GALLERY_PHOTO_UPDATE",
      entityType: "SCHOOL_GALLERY_PHOTO",
      entityId: photo.id,
      oldValue: previous,
      newValue: photo,
      req,
    });
    res.json(photo);
  });

  router.delete("/site-content/gallery/:id", authenticate, manageContent, async (req, res) => {
    const photo = await prisma.schoolGalleryPhoto.findUnique({ where: { id: String(req.params.id) } });
    if (!photo) return res.status(404).json({ error: "Photo introuvable" });
    await prisma.schoolGalleryPhoto.update({ where: { id: photo.id }, data: { active: false } });
    await writeAudit({
      userId: currentAuth(req).sub,
      action: "SITE_GALLERY_PHOTO_ARCHIVE",
      entityType: "SCHOOL_GALLERY_PHOTO",
      entityId: photo.id,
      oldValue: photo,
      newValue: { ...photo, active: false },
      req,
    });
    res.status(204).end();
  });

  router.post(
    "/school-identity/logo",
    authenticate,
    manageIdentity,
    (req, res, next) => imageUpload.single("image")(req, res, (error) => {
      if (!error) return next();
      const message = error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE"
        ? "Le logo dépasse la limite de 5 Mo"
        : "Logo invalide";
      res.status(400).json({ error: message });
    }),
    async (req, res) => {
      const file = req.file;
      if (!file) return res.status(400).json({ error: "Un logo est requis" });
      const extension = imageExtension(file);
      if (!extension) return res.status(400).json({ error: "Formats acceptés : PNG, JPEG ou WebP valide" });
      const image = sharp(file.buffer, { failOn: "error" });
      const metadata = await image.metadata();
      if ((metadata.width ?? 0) < 600) {
        return res.status(400).json({ error: "Le logo doit mesurer au moins 600 pixels de large" });
      }
      const id = randomUUID();
      await mkdir(mediaDirectory, { recursive: true });
      await writeFile(path.join(mediaDirectory, `${id}-original${extension}`), file.buffer, { flag: "wx" });
      for (const width of [64, 128, 256, 512, 1024]) {
        const output = image.clone().resize({ width, fit: "inside" });
        await Promise.all([
          output.clone().webp({ quality: 82, effort: 5 }).toFile(path.join(mediaDirectory, `${id}-${width}.webp`)),
          output.clone().png({ compressionLevel: 9 }).toFile(path.join(mediaDirectory, `${id}-${width}.png`)),
        ]);
      }
      const userId = currentAuth(req).sub;
      const previous = await getIdentity();
      if (!previous) return res.status(503).json({ error: "Identité de l'établissement non initialisée" });
      const url = `/api/public/media/${id}-128.webp`;
      const identity = await prisma.$transaction(async (transaction) => {
        const saved = await transaction.schoolIdentity.update({
          where: { id: previous.id },
          data: {
            logoUrl: url,
            logoVersionId: id,
            version: { increment: 1 },
            updatedBy: userId,
          },
        });
        await transaction.schoolIdentityVersion.create({
          data: {
            schoolIdentityId: saved.id,
            version: saved.version,
            snapshot: identitySnapshot(saved),
            createdBy: userId,
          },
        });
        return saved;
      });
      await writeAudit({
        userId,
        action: "SCHOOL_IDENTITY_LOGO_UPDATE",
        entityType: "SCHOOL_IDENTITY",
        entityId: identity.id,
        oldValue: { logoUrl: previous.logoUrl, logoVersionId: previous.logoVersionId },
        newValue: { logoUrl: url, logoVersionId: id },
        req,
      });
      res.status(201).json({ url, version: identity.version, logoVersionId: id });
    },
  );

  return router;
}
