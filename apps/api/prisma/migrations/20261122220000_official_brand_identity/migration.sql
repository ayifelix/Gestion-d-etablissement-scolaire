ALTER TABLE "SchoolIdentity"
ADD COLUMN "shortName" TEXT NOT NULL DEFAULT 'LYCÉE AKONDA GNAWEME',
ADD COLUMN "monogram" TEXT NOT NULL DEFAULT 'AG',
ADD COLUMN "republicName" TEXT NOT NULL DEFAULT 'République Togolaise',
ADD COLUMN "compactLogoUrl" TEXT,
ADD COLUMN "logoVersionId" TEXT,
ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;

CREATE TABLE "SchoolIdentityVersion" (
  "id" TEXT NOT NULL,
  "schoolIdentityId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "snapshot" JSONB NOT NULL,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SchoolIdentityVersion_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SchoolIdentityVersion_schoolIdentityId_fkey"
    FOREIGN KEY ("schoolIdentityId") REFERENCES "SchoolIdentity"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "SchoolIdentityVersion_schoolIdentityId_version_key"
ON "SchoolIdentityVersion"("schoolIdentityId", "version");

CREATE INDEX "SchoolIdentityVersion_schoolIdentityId_createdAt_idx"
ON "SchoolIdentityVersion"("schoolIdentityId", "createdAt");

ALTER TABLE "Student"
ADD COLUMN "isDemo" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "OfficialDocument"
ADD COLUMN "specimen" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "identitySnapshot" JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE "SchoolPayment"
ADD COLUMN "specimen" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "identitySnapshot" JSONB NOT NULL DEFAULT '{}'::jsonb;
