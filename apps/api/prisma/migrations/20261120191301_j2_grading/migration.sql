-- CreateEnum
CREATE TYPE "AssessmentKind" AS ENUM ('INTERROGATION', 'DEVOIR', 'COMPOSITION');

-- CreateEnum
CREATE TYPE "AssessmentStatus" AS ENUM ('BROUILLON', 'SOUMISE', 'RENVOYEE', 'VALIDEE');

-- CreateEnum
CREATE TYPE "MarkStatus" AS ENUM ('NOTE', 'ABSENT_JUSTIFIE', 'ABSENT_NON_JUSTIFIE', 'DISPENSE', 'NON_NOTE');

-- CreateEnum
CREATE TYPE "CorrectionStatus" AS ENUM ('EN_ATTENTE', 'APPROUVEE', 'REFUSEE');

-- CreateEnum
CREATE TYPE "ReportCardStatus" AS ENUM ('BROUILLON', 'APPRECIATIONS', 'VALIDEE', 'FIGEE', 'PUBLIEE');

-- CreateTable
CREATE TABLE "CalculationRule" (
    "id" TEXT NOT NULL,
    "yearId" TEXT NOT NULL,
    "cycleId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "classworkWeight" DECIMAL(5,4) NOT NULL DEFAULT 0.5,
    "compositionWeight" DECIMAL(5,4) NOT NULL DEFAULT 0.5,
    "annualPeriodWeights" JSONB NOT NULL,
    "roundingDigits" INTEGER NOT NULL DEFAULT 2,
    "thresholds" JSONB,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT NOT NULL,

    CONSTRAINT "CalculationRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Assessment" (
    "id" TEXT NOT NULL,
    "yearId" TEXT NOT NULL,
    "periodId" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "teacherId" TEXT NOT NULL,
    "kind" "AssessmentKind" NOT NULL,
    "title" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "maxScore" DECIMAL(6,2) NOT NULL,
    "status" "AssessmentStatus" NOT NULL DEFAULT 'BROUILLON',
    "sheetNumber" TEXT NOT NULL,
    "qrToken" TEXT NOT NULL,
    "paperRef" TEXT,
    "returnedComment" TEXT,
    "submittedAt" TIMESTAMP(3),
    "verifiedAt" TIMESTAMP(3),
    "verifiedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Assessment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudentMark" (
    "id" TEXT NOT NULL,
    "assessmentId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "value" DECIMAL(6,2),
    "scale" DECIMAL(6,2) NOT NULL,
    "status" "MarkStatus" NOT NULL DEFAULT 'NON_NOTE',
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudentMark_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarkCheck" (
    "id" TEXT NOT NULL,
    "markId" TEXT NOT NULL,
    "verifierId" TEXT NOT NULL,
    "checked" BOOLEAN NOT NULL DEFAULT false,
    "checkedAt" TIMESTAMP(3),

    CONSTRAINT "MarkCheck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarkCorrection" (
    "id" TEXT NOT NULL,
    "markId" TEXT NOT NULL,
    "requestedBy" TEXT NOT NULL,
    "oldValue" DECIMAL(6,2),
    "newValue" DECIMAL(6,2),
    "reason" TEXT NOT NULL,
    "status" "CorrectionStatus" NOT NULL DEFAULT 'EN_ATTENTE',
    "approvedBy" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarkCorrection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClassAppreciation" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "teacherId" TEXT NOT NULL,
    "yearId" TEXT NOT NULL,
    "periodId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "councilOpinion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClassAppreciation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportCard" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "yearId" TEXT NOT NULL,
    "periodId" TEXT NOT NULL,
    "status" "ReportCardStatus" NOT NULL DEFAULT 'BROUILLON',
    "ruleVersion" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "generatedBy" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "frozenAt" TIMESTAMP(3),

    CONSTRAINT "ReportCard_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CalculationRule_yearId_cycleId_active_idx" ON "CalculationRule"("yearId", "cycleId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "CalculationRule_yearId_cycleId_version_key" ON "CalculationRule"("yearId", "cycleId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "Assessment_sheetNumber_key" ON "Assessment"("sheetNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Assessment_qrToken_key" ON "Assessment"("qrToken");

-- CreateIndex
CREATE INDEX "Assessment_classId_subjectId_yearId_periodId_status_idx" ON "Assessment"("classId", "subjectId", "yearId", "periodId", "status");

-- CreateIndex
CREATE INDEX "Assessment_teacherId_date_idx" ON "Assessment"("teacherId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "StudentMark_assessmentId_studentId_key" ON "StudentMark"("assessmentId", "studentId");

-- CreateIndex
CREATE UNIQUE INDEX "MarkCheck_markId_verifierId_key" ON "MarkCheck"("markId", "verifierId");

-- CreateIndex
CREATE INDEX "MarkCorrection_markId_status_idx" ON "MarkCorrection"("markId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ClassAppreciation_studentId_yearId_periodId_key" ON "ClassAppreciation"("studentId", "yearId", "periodId");

-- CreateIndex
CREATE INDEX "ReportCard_classId_yearId_periodId_status_idx" ON "ReportCard"("classId", "yearId", "periodId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ReportCard_studentId_yearId_periodId_key" ON "ReportCard"("studentId", "yearId", "periodId");

-- AddForeignKey
ALTER TABLE "CalculationRule" ADD CONSTRAINT "CalculationRule_yearId_fkey" FOREIGN KEY ("yearId") REFERENCES "AcademicYear"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalculationRule" ADD CONSTRAINT "CalculationRule_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "Cycle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assessment" ADD CONSTRAINT "Assessment_yearId_fkey" FOREIGN KEY ("yearId") REFERENCES "AcademicYear"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assessment" ADD CONSTRAINT "Assessment_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "Period"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assessment" ADD CONSTRAINT "Assessment_classId_fkey" FOREIGN KEY ("classId") REFERENCES "SchoolClass"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assessment" ADD CONSTRAINT "Assessment_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assessment" ADD CONSTRAINT "Assessment_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "Teacher"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentMark" ADD CONSTRAINT "StudentMark_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "Assessment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentMark" ADD CONSTRAINT "StudentMark_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarkCheck" ADD CONSTRAINT "MarkCheck_markId_fkey" FOREIGN KEY ("markId") REFERENCES "StudentMark"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarkCorrection" ADD CONSTRAINT "MarkCorrection_markId_fkey" FOREIGN KEY ("markId") REFERENCES "StudentMark"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassAppreciation" ADD CONSTRAINT "ClassAppreciation_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassAppreciation" ADD CONSTRAINT "ClassAppreciation_classId_fkey" FOREIGN KEY ("classId") REFERENCES "SchoolClass"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassAppreciation" ADD CONSTRAINT "ClassAppreciation_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "Teacher"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportCard" ADD CONSTRAINT "ReportCard_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportCard" ADD CONSTRAINT "ReportCard_classId_fkey" FOREIGN KEY ("classId") REFERENCES "SchoolClass"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportCard" ADD CONSTRAINT "ReportCard_yearId_fkey" FOREIGN KEY ("yearId") REFERENCES "AcademicYear"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportCard" ADD CONSTRAINT "ReportCard_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "Period"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
