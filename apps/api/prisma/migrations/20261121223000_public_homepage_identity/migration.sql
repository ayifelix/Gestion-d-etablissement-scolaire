CREATE TABLE "SchoolIdentity" (
  "id" TEXT NOT NULL DEFAULT 'school',
  "schoolName" TEXT NOT NULL DEFAULT 'LYCÉE AKONDA GNAWEME',
  "cycleSubtitle" TEXT NOT NULL DEFAULT 'Collège et Lycée',
  "ministry" TEXT NOT NULL DEFAULT 'Ministère des Enseignements Primaire et Secondaire (MEPS)',
  "regionalDirectorate" TEXT NOT NULL DEFAULT 'DRE-Maritime',
  "inspection" TEXT NOT NULL DEFAULT 'IESG-Vogan',
  "republicMotto" TEXT NOT NULL DEFAULT 'Travail - Liberté - Patrie',
  "schoolMotto" TEXT NOT NULL DEFAULT 'Discipline - Travail - Succès',
  "address" TEXT NOT NULL DEFAULT '',
  "phone" TEXT NOT NULL DEFAULT '',
  "email" TEXT NOT NULL DEFAULT '',
  "secretariatHours" TEXT NOT NULL DEFAULT '',
  "headName" TEXT NOT NULL DEFAULT '',
  "headMessage" TEXT NOT NULL DEFAULT '',
  "collegePresentation" TEXT NOT NULL DEFAULT '',
  "lyceePresentation" TEXT NOT NULL DEFAULT '',
  "directionsUrl" TEXT NOT NULL DEFAULT '',
  "logoUrl" TEXT,
  "photoUrl" TEXT,
  "updatedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "SchoolIdentity_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PublicAnnouncement" (
  "id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "summary" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "eventAt" TIMESTAMP(3),
  "published" BOOLEAN NOT NULL DEFAULT false,
  "archivedAt" TIMESTAMP(3),
  "createdBy" TEXT NOT NULL,
  "updatedBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "PublicAnnouncement_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PublicAnnouncement_published_archivedAt_eventAt_idx"
  ON "PublicAnnouncement"("published", "archivedAt", "eventAt");

ALTER TABLE "User"
  ADD COLUMN "twoFactorSecret" TEXT;
