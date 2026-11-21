import { Router, type Request, type RequestHandler } from "express";
import { PersonRole, PrismaClient, ScopeType } from "@prisma/client";
import { z } from "zod";
import {
  calculateOvertimeHours,
  countWeekdayOccurrences,
  exceedsAssignmentHours,
  hoursBetweenMinutes,
  projectWeeklyHours,
  roundHours,
} from "./workload-rules";

type AuthContext = {
  sub: string;
  personId: string;
  roles: { code: PersonRole; scopeType: ScopeType; scopeId?: string | null }[];
};

type WorkloadDependencies = {
  prisma: PrismaClient;
  authenticate: RequestHandler;
  requireRole: (...codes: PersonRole[]) => RequestHandler;
  currentAuth: (req: Request) => AuthContext;
  canAccessClass: (auth: AuthContext, classId: string) => Promise<boolean>;
};

type WorkloadRow = {
  teacherId: string;
  teacherName: string;
  teacherStatus: string;
  cycleId: string | null;
  cycleLabel: string | null;
  assignmentWeeklyHours: number;
  plannedHours: number;
  scheduledWeeklyHours: number;
  scheduledHours: number;
  performedHours: number;
  overtimeHours: number;
  unmeasuredEntries: number;
  alerts: string[];
};

const querySchema = z.object({
  yearId: z.string().uuid(),
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Mois invalide (AAAA-MM)"),
});

const managerRoles: PersonRole[] = [PersonRole.DIR, PersonRole.CEN];

function rowKey(teacherId: string, cycleId: string | null) {
  return `${teacherId}:${cycleId ?? "sans-cycle"}`;
}

function assignmentKey(teacherId: string, classId: string, subjectId: string) {
  return `${teacherId}:${classId}:${subjectId}`;
}

function latestDate(...dates: Date[]) {
  return new Date(Math.max(...dates.map((date) => date.getTime())));
}

function earliestDate(...dates: Date[]) {
  return new Date(Math.min(...dates.map((date) => date.getTime())));
}

function dayOnly(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function dateOverlaps(start: Date, end: Date | null, periodStart: Date, periodEnd: Date) {
  return start <= periodEnd && (!end || end >= periodStart);
}

function addRow(
  rows: Map<string, WorkloadRow>,
  teacher: { id: string; status: string; person: { nom: string; prenoms: string } },
  cycleId: string | null,
  cycleLabel: string | null,
) {
  const key = rowKey(teacher.id, cycleId);
  let row = rows.get(key);
  if (!row) {
    row = {
      teacherId: teacher.id,
      teacherName: `${teacher.person.nom} ${teacher.person.prenoms}`.trim(),
      teacherStatus: teacher.status,
      cycleId,
      cycleLabel,
      assignmentWeeklyHours: 0,
      plannedHours: 0,
      scheduledWeeklyHours: 0,
      scheduledHours: 0,
      performedHours: 0,
      overtimeHours: 0,
      unmeasuredEntries: 0,
      alerts: [],
    };
    rows.set(key, row);
  }
  return row;
}

export function createWorkloadRouter(deps: WorkloadDependencies) {
  const { prisma, authenticate, requireRole, currentAuth, canAccessClass } = deps;
  const router = Router();

  router.get(
    "/workload",
    authenticate,
    requireRole(PersonRole.DIR, PersonRole.CEN, PersonRole.PROF, PersonRole.TIT),
    async (req, res) => {
      const parsed = querySchema.safeParse(req.query);
      if (!parsed.success) return res.status(400).json({ error: z.prettifyError(parsed.error) });

      const auth = currentAuth(req);
      const isManager = auth.roles.some((role) => managerRoles.includes(role.code));
      const isProfessor = auth.roles.some((role) => role.code === PersonRole.PROF);
      const teacher = await prisma.teacher.findUnique({
        where: { personId: auth.personId },
        include: { person: true },
      });
      if (!isManager && isProfessor && !teacher) {
        return res.status(403).json({ error: "Aucun dossier enseignant n'est associé à ce compte" });
      }

      const year = await prisma.academicYear.findUnique({ where: { id: parsed.data.yearId } });
      if (!year) return res.status(404).json({ error: "Année scolaire introuvable" });

      const [yearNumber, monthNumber] = parsed.data.month.split("-").map(Number);
      const monthStart = new Date(Date.UTC(yearNumber, monthNumber - 1, 1));
      const monthEnd = new Date(Date.UTC(yearNumber, monthNumber, 0, 23, 59, 59, 999));
      if (!dateOverlaps(monthStart, monthEnd, year.dateStart, year.dateEnd)) {
        return res.status(400).json({ error: "Le mois choisi est hors de l'année scolaire" });
      }
      const periodStart = latestDate(monthStart, year.dateStart);
      const periodEnd = earliestDate(monthEnd, year.dateEnd);

      const assignments = await prisma.teachingAssignment.findMany({
        where: {
          yearId: year.id,
          ...(!isManager && isProfessor ? { teacherId: teacher!.id } : {}),
          dateStart: { lte: periodEnd },
          OR: [{ dateEnd: null }, { dateEnd: { gte: periodStart } }],
        },
        include: {
          teacher: { include: { person: true } },
          class: { include: { pathway: { include: { level: { include: { cycle: true } } } } } },
        },
      });
      const accessibleClassIds = new Set(
        (await Promise.all(
          [...new Set(assignments.map((assignment) => assignment.classId))].map(async (classId) =>
            await canAccessClass(auth, classId) ? classId : null,
          ),
        )).filter((classId): classId is string => classId !== null),
      );
      const visibleAssignments = assignments.filter((assignment) => accessibleClassIds.has(assignment.classId));
      const visibleTeacherIds = new Set(visibleAssignments.map((assignment) => assignment.teacherId));
      if (teacher && !isManager && isProfessor) visibleTeacherIds.add(teacher.id);
      const visibleClassIds = [...accessibleClassIds];
      const visibleAssignmentKeys = new Map<string, typeof visibleAssignments>();
      for (const assignment of visibleAssignments) {
        const key = assignmentKey(assignment.teacherId, assignment.classId, assignment.subjectId);
        const matching = visibleAssignmentKeys.get(key) ?? [];
        matching.push(assignment);
        visibleAssignmentKeys.set(key, matching);
      }

      const timetableSessions = visibleClassIds.length
        ? await prisma.timetableSession.findMany({
          where: {
            yearId: year.id,
            classId: { in: visibleClassIds },
            teacherId: { in: [...visibleTeacherIds] },
            dateStart: { lte: periodEnd },
            OR: [{ dateEnd: null }, { dateEnd: { gte: periodStart } }],
          },
          include: { slot: true },
        })
        : [];
      const sessionsById = new Map(timetableSessions.map((session) => [session.id, session]));
      const sessionsByAssignment = new Map<string, typeof timetableSessions>();
      for (const session of timetableSessions) {
        const key = assignmentKey(session.teacherId, session.classId, session.subjectId);
        const relatedAssignments = visibleAssignmentKeys.get(key) ?? [];
        if (!relatedAssignments.some((assignment) =>
          dateOverlaps(assignment.dateStart, assignment.dateEnd, session.dateStart, session.dateEnd ?? periodEnd),
        )) continue;
        const matching = sessionsByAssignment.get(key) ?? [];
        matching.push(session);
        sessionsByAssignment.set(key, matching);
      }

      const rows = new Map<string, WorkloadRow>();
      for (const assignment of visibleAssignments) {
        const cycle = assignment.class.pathway.level.cycle;
        const row = addRow(rows, assignment.teacher, cycle.id, cycle.label);
        const activeStart = latestDate(periodStart, assignment.dateStart);
        const activeEnd = earliestDate(periodEnd, assignment.dateEnd ?? periodEnd);
        row.assignmentWeeklyHours += Number(assignment.weeklyHours);
        row.plannedHours += projectWeeklyHours(Number(assignment.weeklyHours), activeStart, activeEnd);

        const matchingSessions = sessionsByAssignment.get(
          assignmentKey(assignment.teacherId, assignment.classId, assignment.subjectId),
        ) ?? [];
        for (const session of matchingSessions) {
          const sessionStart = latestDate(activeStart, session.dateStart);
          const sessionEnd = earliestDate(activeEnd, session.dateEnd ?? activeEnd);
          const weeklySessionHours = hoursBetweenMinutes(session.slot.startMinute, session.slot.endMinute);
          row.scheduledWeeklyHours += weeklySessionHours;
          row.scheduledHours += weeklySessionHours * countWeekdayOccurrences(
            dayOnly(sessionStart),
            dayOnly(sessionEnd),
            session.slot.weekday,
          );
        }
      }

      const textbookEntries = visibleClassIds.length && visibleTeacherIds.size
        ? await prisma.textbookEntry.findMany({
          where: {
            classId: { in: visibleClassIds },
            teacherId: { in: [...visibleTeacherIds] },
            date: { gte: periodStart, lte: periodEnd },
            courseHeld: true,
          },
          include: { class: { include: { pathway: { include: { level: { include: { cycle: true } } } } } } },
        })
        : [];
      for (const entry of textbookEntries) {
        const cycle = entry.class.pathway.level.cycle;
        const row = addRow(rows, {
          id: entry.teacherId,
          status: "INCONNU",
          person: { nom: "", prenoms: "" },
        }, cycle.id, cycle.label);
        const session = entry.sessionId ? sessionsById.get(entry.sessionId) : undefined;
        const matchingAssignments = visibleAssignmentKeys.get(
          assignmentKey(entry.teacherId, entry.classId, entry.subjectId),
        ) ?? [];
        const entryDate = dayOnly(entry.date);
        const activeAssignment = matchingAssignments.some((assignment) =>
          dateOverlaps(assignment.dateStart, assignment.dateEnd, entryDate, entryDate),
        );
        const isCorrectSession = session &&
          session.teacherId === entry.teacherId &&
          session.classId === entry.classId &&
          session.subjectId === entry.subjectId &&
          session.slot.weekday === (entryDate.getUTCDay() || 7) &&
          dateOverlaps(session.dateStart, session.dateEnd, entryDate, entryDate);
        if (!session || !activeAssignment || !isCorrectSession) {
          row.unmeasuredEntries++;
          continue;
        }
        row.performedHours += hoursBetweenMinutes(session.slot.startMinute, session.slot.endMinute);
      }

      if (isManager && auth.roles.some((role) =>
        managerRoles.includes(role.code) && role.scopeType === ScopeType.ETABLISSEMENT,
      )) {
        const teachers = await prisma.teacher.findMany({ include: { person: true } });
        for (const item of teachers) {
          if (!visibleTeacherIds.has(item.id)) {
            addRow(rows, item, null, null);
          }
        }
      } else if (teacher && !isManager && isProfessor && !rows.size) {
        addRow(rows, teacher, null, null);
      }

      const outputRows = [...rows.values()].map((row) => {
        row.assignmentWeeklyHours = roundHours(row.assignmentWeeklyHours);
        row.plannedHours = roundHours(row.plannedHours);
        row.scheduledWeeklyHours = roundHours(row.scheduledWeeklyHours);
        row.scheduledHours = roundHours(row.scheduledHours);
        row.performedHours = roundHours(row.performedHours);
        row.overtimeHours = calculateOvertimeHours(row.performedHours, row.plannedHours);
        if (exceedsAssignmentHours(row.assignmentWeeklyHours, row.scheduledWeeklyHours)) {
          row.alerts.push("L'emploi du temps dépasse les heures d'affectation.");
        }
        if (row.overtimeHours > 0) row.alerts.push("Les heures effectuées dépassent le volume prévu.");
        if (row.unmeasuredEntries > 0) {
          row.alerts.push(`${row.unmeasuredEntries} cours effectués n'ont pas de séance horaire exploitable.`);
        }
        return row;
      }).sort((a, b) =>
        a.teacherName.localeCompare(b.teacherName, "fr") ||
        (a.cycleLabel ?? "").localeCompare(b.cycleLabel ?? "", "fr"),
      );

      const cycleTotals = new Map<string, {
        cycleId: string | null;
        cycleLabel: string | null;
        assignmentWeeklyHours: number;
        plannedHours: number;
        scheduledHours: number;
        performedHours: number;
        overtimeHours: number;
      }>();
      for (const row of outputRows) {
        const key = row.cycleId ?? "sans-cycle";
        const total = cycleTotals.get(key) ?? {
          cycleId: row.cycleId,
          cycleLabel: row.cycleLabel,
          assignmentWeeklyHours: 0,
          plannedHours: 0,
          scheduledHours: 0,
          performedHours: 0,
          overtimeHours: 0,
        };
        total.assignmentWeeklyHours += row.assignmentWeeklyHours;
        total.plannedHours += row.plannedHours;
        total.scheduledHours += row.scheduledHours;
        total.performedHours += row.performedHours;
        total.overtimeHours += row.overtimeHours;
        cycleTotals.set(key, total);
      }

      res.json({
        year: { id: year.id, label: year.label },
        month: parsed.data.month,
        rows: outputRows,
        cycles: [...cycleTotals.values()].map((total) => ({
          ...total,
          assignmentWeeklyHours: roundHours(total.assignmentWeeklyHours),
          plannedHours: roundHours(total.plannedHours),
          scheduledHours: roundHours(total.scheduledHours),
          performedHours: roundHours(total.performedHours),
          overtimeHours: roundHours(total.overtimeHours),
        })),
      });
    },
  );

  return router;
}
