CREATE TABLE "OfficialDocument" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "verificationToken" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "yearId" TEXT NOT NULL,
    "reportCardId" TEXT,
    "issuedBy" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "revokeReason" TEXT,

    CONSTRAINT "OfficialDocument_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OfficialDocument_number_key" ON "OfficialDocument"("number");
CREATE UNIQUE INDEX "OfficialDocument_verificationToken_key" ON "OfficialDocument"("verificationToken");
CREATE INDEX "OfficialDocument_studentId_yearId_issuedAt_idx" ON "OfficialDocument"("studentId", "yearId", "issuedAt");
CREATE INDEX "OfficialDocument_reportCardId_idx" ON "OfficialDocument"("reportCardId");

ALTER TABLE "OfficialDocument" ADD CONSTRAINT "OfficialDocument_studentId_fkey"
    FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OfficialDocument" ADD CONSTRAINT "OfficialDocument_yearId_fkey"
    FOREIGN KEY ("yearId") REFERENCES "AcademicYear"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OfficialDocument" ADD CONSTRAINT "OfficialDocument_reportCardId_fkey"
    FOREIGN KEY ("reportCardId") REFERENCES "ReportCard"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
