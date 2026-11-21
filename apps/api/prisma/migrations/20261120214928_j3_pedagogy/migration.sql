-- CreateEnum
CREATE TYPE "AttendanceStatus" AS ENUM ('PRESENT', 'ABSENT', 'RETARD', 'EXCUSE');

-- CreateEnum
CREATE TYPE "OrientationStatus" AS ENUM ('BROUILLON', 'OUVERTE', 'CLOTUREE');

-- CreateEnum
CREATE TYPE "OrientationChoice" AS ENUM ('D', 'C', 'A4');

-- CreateEnum
CREATE TYPE "CouncilStatus" AS ENUM ('PREPARATION', 'TENU', 'ARCHIVE');

-- CreateTable
CREATE TABLE "TimetableSlot" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "weekday" INTEGER NOT NULL,
    "startMinute" INTEGER NOT NULL,
    "endMinute" INTEGER NOT NULL,

    CONSTRAINT "TimetableSlot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeacherUnavailability" (
    "id" TEXT NOT NULL,
    "teacherId" TEXT NOT NULL,
    "weekday" INTEGER NOT NULL,
    "startMinute" INTEGER NOT NULL,
    "endMinute" INTEGER NOT NULL,
    "dateStart" TIMESTAMP(3),
    "dateEnd" TIMESTAMP(3),
    "reason" TEXT NOT NULL,

    CONSTRAINT "TeacherUnavailability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimetableSession" (
    "id" TEXT NOT NULL,
    "yearId" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "teacherId" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "slotId" TEXT NOT NULL,
    "dateStart" TIMESTAMP(3) NOT NULL,
    "dateEnd" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TimetableSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttendanceCall" (
    "id" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "calledBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AttendanceCall_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttendanceEntry" (
    "id" TEXT NOT NULL,
    "callId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "status" "AttendanceStatus" NOT NULL DEFAULT 'PRESENT',
    "minutesLate" INTEGER,
    "justification" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AttendanceEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TextbookEntry" (
    "id" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "teacherId" TEXT NOT NULL,
    "sessionId" TEXT,
    "date" DATE NOT NULL,
    "chapter" TEXT,
    "content" TEXT NOT NULL,
    "homework" TEXT,
    "courseHeld" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TextbookEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrientationCampaign" (
    "id" TEXT NOT NULL,
    "yearId" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "status" "OrientationStatus" NOT NULL DEFAULT 'BROUILLON',
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrientationCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrientationStudent" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "familyFirst" "OrientationChoice",
    "familySecond" "OrientationChoice",
    "councilOpinion" "OrientationChoice",
    "finalDecision" "OrientationChoice",
    "provisionalOrientation" TEXT,
    "meanMaths" DECIMAL(5,2),
    "meanPhysics" DECIMAL(5,2),
    "meanBiology" DECIMAL(5,2),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrientationStudent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CouncilMeeting" (
    "id" TEXT NOT NULL,
    "yearId" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "periodId" TEXT,
    "status" "CouncilStatus" NOT NULL DEFAULT 'PREPARATION',
    "minutes" TEXT,
    "heldAt" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CouncilMeeting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CouncilDecision" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "proposal" TEXT,
    "comment" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CouncilDecision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TimetableSlot_weekday_startMinute_idx" ON "TimetableSlot"("weekday", "startMinute");

-- CreateIndex
CREATE UNIQUE INDEX "TimetableSlot_weekday_startMinute_endMinute_key" ON "TimetableSlot"("weekday", "startMinute", "endMinute");

-- CreateIndex
CREATE INDEX "TeacherUnavailability_teacherId_weekday_idx" ON "TeacherUnavailability"("teacherId", "weekday");

-- CreateIndex
CREATE INDEX "TimetableSession_yearId_classId_slotId_dateStart_dateEnd_idx" ON "TimetableSession"("yearId", "classId", "slotId", "dateStart", "dateEnd");

-- CreateIndex
CREATE INDEX "TimetableSession_teacherId_slotId_dateStart_dateEnd_idx" ON "TimetableSession"("teacherId", "slotId", "dateStart", "dateEnd");

-- CreateIndex
CREATE INDEX "TimetableSession_roomId_slotId_dateStart_dateEnd_idx" ON "TimetableSession"("roomId", "slotId", "dateStart", "dateEnd");

-- CreateIndex
CREATE UNIQUE INDEX "AttendanceCall_classId_date_key" ON "AttendanceCall"("classId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "AttendanceEntry_callId_studentId_key" ON "AttendanceEntry"("callId", "studentId");

-- CreateIndex
CREATE INDEX "TextbookEntry_classId_date_idx" ON "TextbookEntry"("classId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "TextbookEntry_classId_subjectId_teacherId_date_key" ON "TextbookEntry"("classId", "subjectId", "teacherId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "OrientationCampaign_yearId_classId_key" ON "OrientationCampaign"("yearId", "classId");

-- CreateIndex
CREATE UNIQUE INDEX "OrientationStudent_campaignId_studentId_key" ON "OrientationStudent"("campaignId", "studentId");

-- CreateIndex
CREATE INDEX "CouncilMeeting_yearId_classId_periodId_idx" ON "CouncilMeeting"("yearId", "classId", "periodId");

-- CreateIndex
CREATE UNIQUE INDEX "CouncilDecision_meetingId_studentId_key" ON "CouncilDecision"("meetingId", "studentId");

-- AddForeignKey
ALTER TABLE "TeacherUnavailability" ADD CONSTRAINT "TeacherUnavailability_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "Teacher"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimetableSession" ADD CONSTRAINT "TimetableSession_yearId_fkey" FOREIGN KEY ("yearId") REFERENCES "AcademicYear"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimetableSession" ADD CONSTRAINT "TimetableSession_classId_fkey" FOREIGN KEY ("classId") REFERENCES "SchoolClass"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimetableSession" ADD CONSTRAINT "TimetableSession_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimetableSession" ADD CONSTRAINT "TimetableSession_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "Teacher"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimetableSession" ADD CONSTRAINT "TimetableSession_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimetableSession" ADD CONSTRAINT "TimetableSession_slotId_fkey" FOREIGN KEY ("slotId") REFERENCES "TimetableSlot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceCall" ADD CONSTRAINT "AttendanceCall_classId_fkey" FOREIGN KEY ("classId") REFERENCES "SchoolClass"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceEntry" ADD CONSTRAINT "AttendanceEntry_callId_fkey" FOREIGN KEY ("callId") REFERENCES "AttendanceCall"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceEntry" ADD CONSTRAINT "AttendanceEntry_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TextbookEntry" ADD CONSTRAINT "TextbookEntry_classId_fkey" FOREIGN KEY ("classId") REFERENCES "SchoolClass"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TextbookEntry" ADD CONSTRAINT "TextbookEntry_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TextbookEntry" ADD CONSTRAINT "TextbookEntry_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "Teacher"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrientationCampaign" ADD CONSTRAINT "OrientationCampaign_yearId_fkey" FOREIGN KEY ("yearId") REFERENCES "AcademicYear"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrientationCampaign" ADD CONSTRAINT "OrientationCampaign_classId_fkey" FOREIGN KEY ("classId") REFERENCES "SchoolClass"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrientationStudent" ADD CONSTRAINT "OrientationStudent_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "OrientationCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrientationStudent" ADD CONSTRAINT "OrientationStudent_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CouncilMeeting" ADD CONSTRAINT "CouncilMeeting_yearId_fkey" FOREIGN KEY ("yearId") REFERENCES "AcademicYear"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CouncilMeeting" ADD CONSTRAINT "CouncilMeeting_classId_fkey" FOREIGN KEY ("classId") REFERENCES "SchoolClass"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CouncilDecision" ADD CONSTRAINT "CouncilDecision_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "CouncilMeeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CouncilDecision" ADD CONSTRAINT "CouncilDecision_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
