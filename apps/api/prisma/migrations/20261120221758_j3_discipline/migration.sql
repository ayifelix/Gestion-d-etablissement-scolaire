-- CreateEnum
CREATE TYPE "DisciplineIncidentStatus" AS ENUM ('SIGNALE', 'DECIDE', 'NOTIFIE', 'CLOTURE');

-- CreateEnum
CREATE TYPE "StudentFollowUpKind" AS ENUM ('ENTRETIEN', 'APPEL_PARENT', 'CONVOCATION', 'CONSEIL_DISCIPLINE');

-- CreateTable
CREATE TABLE "DisciplineScale" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "points" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DisciplineScale_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DisciplineIncident" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "evidenceRef" TEXT,
    "reportedBy" TEXT NOT NULL,
    "status" "DisciplineIncidentStatus" NOT NULL DEFAULT 'SIGNALE',
    "scaleId" TEXT,
    "decision" TEXT,
    "decidedBy" TEXT,
    "decidedAt" TIMESTAMP(3),
    "parentNotifiedAt" TIMESTAMP(3),
    "disciplineCouncilRequired" BOOLEAN NOT NULL DEFAULT false,
    "disciplineCouncilAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DisciplineIncident_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudentFollowUp" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "incidentId" TEXT,
    "kind" "StudentFollowUpKind" NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "summary" TEXT NOT NULL,
    "parentContact" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StudentFollowUp_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DisciplineScale_code_key" ON "DisciplineScale"("code");

-- CreateIndex
CREATE INDEX "DisciplineIncident_classId_occurredAt_status_idx" ON "DisciplineIncident"("classId", "occurredAt", "status");

-- CreateIndex
CREATE INDEX "DisciplineIncident_studentId_occurredAt_idx" ON "DisciplineIncident"("studentId", "occurredAt");

-- CreateIndex
CREATE INDEX "StudentFollowUp_classId_studentId_occurredAt_idx" ON "StudentFollowUp"("classId", "studentId", "occurredAt");

-- AddForeignKey
ALTER TABLE "DisciplineIncident" ADD CONSTRAINT "DisciplineIncident_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DisciplineIncident" ADD CONSTRAINT "DisciplineIncident_classId_fkey" FOREIGN KEY ("classId") REFERENCES "SchoolClass"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DisciplineIncident" ADD CONSTRAINT "DisciplineIncident_scaleId_fkey" FOREIGN KEY ("scaleId") REFERENCES "DisciplineScale"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentFollowUp" ADD CONSTRAINT "StudentFollowUp_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentFollowUp" ADD CONSTRAINT "StudentFollowUp_classId_fkey" FOREIGN KEY ("classId") REFERENCES "SchoolClass"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentFollowUp" ADD CONSTRAINT "StudentFollowUp_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "DisciplineIncident"("id") ON DELETE SET NULL ON UPDATE CASCADE;
