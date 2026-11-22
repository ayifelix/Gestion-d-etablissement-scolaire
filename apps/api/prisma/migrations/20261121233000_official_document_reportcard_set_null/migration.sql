ALTER TABLE "OfficialDocument" DROP CONSTRAINT "OfficialDocument_reportCardId_fkey";

ALTER TABLE "OfficialDocument" ADD CONSTRAINT "OfficialDocument_reportCardId_fkey"
    FOREIGN KEY ("reportCardId") REFERENCES "ReportCard"("id") ON DELETE SET NULL ON UPDATE CASCADE;
