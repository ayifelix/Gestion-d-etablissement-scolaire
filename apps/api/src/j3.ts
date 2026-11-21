import { Router, type Request, type RequestHandler } from "express";
import {
  AttendanceStatus,
  CouncilStatus,
  DisciplineIncidentStatus,
  OrientationChoice,
  OrientationStatus,
  PersonRole,
  Prisma,
  PrismaClient,
  ScopeType,
  StudentFollowUpKind,
} from "@prisma/client";
import { z } from "zod";
import { canTransitionIncident } from "./discipline-rules";
import { findScheduleConflicts, type ScheduleSession } from "./j3-rules";

type AuthContext = {
  sub: string;
  personId: string;
  roles: { code: PersonRole; scopeType: ScopeType; scopeId?: string | null }[];
};

type J3Dependencies = {
  prisma: PrismaClient;
  authenticate: RequestHandler;
  requireRole: (...codes: PersonRole[]) => RequestHandler;
  currentAuth: (req: Request) => AuthContext;
  canAccessClass: (auth: AuthContext, classId: string) => Promise<boolean>;
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

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, "Date invalide").transform((value) => new Date(`${value}T00:00:00.000Z`));

const choice = z.nativeEnum(OrientationChoice);
const attendanceEntry = z.object({
  studentId: z.string().uuid(),
  status: z.nativeEnum(AttendanceStatus),
  minutesLate: z.number().int().positive().optional(),
  justification: z.string().trim().max(1000).optional(),
});

export function createJ3Router(deps: J3Dependencies) {
  const { prisma, authenticate, requireRole, currentAuth, canAccessClass, writeAudit } = deps;
  const router = Router();

  async function activeStudents(classId: string, yearId: string, onDate: Date) {
    return prisma.enrollment.findMany({
      where: {
        classId,
        yearId,
        status: "ACTIVE",
        dateStart: { lte: onDate },
        OR: [{ dateEnd: null }, { dateEnd: { gte: onDate } }],
      },
      include: { student: { include: { person: true } } },
      orderBy: { student: { person: { nom: "asc" } } },
    });
  }

  async function assignedTeacher(personId: string, classId: string, subjectId: string, yearId: string, onDate: Date) {
    const teacher = await prisma.teacher.findUnique({ where: { personId } });
    if (!teacher || (teacher.dateDeparture && teacher.dateDeparture < onDate)) return null;
    const assignment = await prisma.teachingAssignment.findFirst({
      where: {
        teacherId: teacher.id,
        classId,
        subjectId,
        yearId,
        status: "EN_COURS",
        dateStart: { lte: onDate },
        OR: [{ dateEnd: null }, { dateEnd: { gte: onDate } }],
      },
    });
    return assignment ? teacher : null;
  }

  router.get("/timetable/slots", authenticate, async (_req, res) => {
    res.json(await prisma.timetableSlot.findMany({ orderBy: [{ weekday: "asc" }, { startMinute: "asc" }] }));
  });

  router.get("/rooms", authenticate, requireRole(PersonRole.DIR, PersonRole.CEN, PersonRole.SG, PersonRole.PROF, PersonRole.TIT), async (_req, res) => {
    res.json(await prisma.room.findMany({ orderBy: { name: "asc" } }));
  });

  router.post("/rooms", authenticate, requireRole(PersonRole.DIR, PersonRole.CEN), async (req, res) => {
    const parsed = z.object({
      name: z.string().trim().min(1).max(100),
      capacity: z.number().int().positive(),
      type: z.string().trim().min(1).max(80),
      site: z.string().trim().max(100).optional(),
    }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: z.prettifyError(parsed.error) });
    if (await prisma.room.findUnique({ where: { name: parsed.data.name } })) return res.status(409).json({ error: "Cette salle existe déjà" });
    const room = await prisma.room.create({ data: parsed.data });
    await writeAudit({ userId: currentAuth(req).sub, action: "ROOM_CREATE", entityType: "ROOM", entityId: room.id, newValue: room, req });
    res.status(201).json(room);
  });

  router.post("/timetable/slots", authenticate, requireRole(PersonRole.DIR, PersonRole.CEN), async (req, res) => {
    const parsed = z.object({
      label: z.string().trim().min(1).max(80),
      weekday: z.number().int().min(1).max(6),
      startMinute: z.number().int().min(0).max(1439),
      endMinute: z.number().int().min(1).max(1440),
    }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: z.prettifyError(parsed.error) });
    if (parsed.data.endMinute <= parsed.data.startMinute) return res.status(400).json({ error: "L'heure de fin doit suivre l'heure de début" });
    const duplicate = await prisma.timetableSlot.findFirst({
      where: { weekday: parsed.data.weekday, startMinute: parsed.data.startMinute, endMinute: parsed.data.endMinute },
    });
    if (duplicate) return res.status(409).json({ error: "Ce créneau existe déjà" });
    const slot = await prisma.timetableSlot.create({ data: parsed.data });
    await writeAudit({ userId: currentAuth(req).sub, action: "TIMETABLE_SLOT_CREATE", entityType: "TIMETABLE_SLOT", entityId: slot.id, newValue: slot, req });
    res.status(201).json(slot);
  });

  router.post("/timetable/unavailabilities", authenticate, requireRole(PersonRole.DIR, PersonRole.CEN), async (req, res) => {
    const parsed = z.object({
      teacherId: z.string().uuid(),
      weekday: z.number().int().min(1).max(6),
      startMinute: z.number().int().min(0).max(1439),
      endMinute: z.number().int().min(1).max(1440),
      dateStart: z.coerce.date().optional(),
      dateEnd: z.coerce.date().optional(),
      reason: z.string().trim().min(1).max(300),
    }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: z.prettifyError(parsed.error) });
    if (parsed.data.endMinute <= parsed.data.startMinute ||
      (parsed.data.dateStart && parsed.data.dateEnd && parsed.data.dateEnd < parsed.data.dateStart)) {
      return res.status(400).json({ error: "La plage d'indisponibilité est invalide" });
    }
    const unavailable = await prisma.teacherUnavailability.create({ data: parsed.data });
    await writeAudit({ userId: currentAuth(req).sub, action: "TEACHER_UNAVAILABILITY_CREATE", entityType: "TEACHER_UNAVAILABILITY", entityId: unavailable.id, newValue: unavailable, req });
    res.status(201).json(unavailable);
  });

  router.get("/timetable", authenticate, async (req, res) => {
    const classId = String(req.query.classId ?? "");
    if (classId && !await canAccessClass(currentAuth(req), classId)) {
      return res.status(403).json({ error: "Cette classe est hors de votre portée" });
    }
    const weekday = req.query.weekday === undefined ? undefined : Number(req.query.weekday);
    if (weekday !== undefined && (!Number.isInteger(weekday) || weekday < 1 || weekday > 6)) {
      return res.status(400).json({ error: "Jour de la semaine invalide" });
    }
    const sessions = await prisma.timetableSession.findMany({
      where: { ...(classId ? { classId } : {}), ...(weekday ? { slot: { weekday } } : {}) },
      include: {
        class: true,
        subject: true,
        teacher: { include: { person: true } },
        room: true,
        slot: true,
      },
      orderBy: [{ slot: { weekday: "asc" } }, { slot: { startMinute: "asc" } }],
    });
    const accessible = await Promise.all(sessions.map(async (session) =>
      await canAccessClass(currentAuth(req), session.classId) ? session : null,
    ));
    res.json(accessible.filter((session) => session !== null));
  });

  router.post("/timetable/sessions", authenticate, requireRole(PersonRole.DIR, PersonRole.CEN), async (req, res) => {
    const parsed = z.object({
      classId: z.string().uuid(),
      subjectId: z.string().uuid(),
      teacherId: z.string().uuid(),
      roomId: z.string().uuid(),
      slotId: z.string().uuid(),
      dateStart: z.coerce.date(),
      dateEnd: z.coerce.date().nullable().optional(),
    }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: z.prettifyError(parsed.error) });
    const input = parsed.data;
    const auth = currentAuth(req);
    if (!await canAccessClass(auth, input.classId)) return res.status(403).json({ error: "Cette classe est hors de votre portée" });
    const schoolClass = await prisma.schoolClass.findUnique({ where: { id: input.classId }, include: { year: true } });
    if (!schoolClass) return res.status(404).json({ error: "Classe introuvable" });
    if (input.dateEnd && input.dateEnd < input.dateStart) return res.status(400).json({ error: "La date de fin doit suivre la date de début" });
    if (input.dateStart < schoolClass.year.dateStart || input.dateStart > schoolClass.year.dateEnd ||
      (input.dateEnd && input.dateEnd > schoolClass.year.dateEnd)) {
      return res.status(400).json({ error: "Les dates doivent être comprises dans l'année scolaire de la classe" });
    }
    const [slot, room, assignment] = await Promise.all([
      prisma.timetableSlot.findUnique({ where: { id: input.slotId } }),
      prisma.room.findUnique({ where: { id: input.roomId } }),
      prisma.teachingAssignment.findFirst({
        where: {
          classId: input.classId,
          subjectId: input.subjectId,
          teacherId: input.teacherId,
          yearId: schoolClass.yearId,
          status: "EN_COURS",
          dateStart: { lte: input.dateStart },
          OR: [{ dateEnd: null }, { dateEnd: { gte: input.dateStart } }],
        },
      }),
    ]);
    if (!slot || !room) return res.status(400).json({ error: "Créneau ou salle introuvable" });
    if (!assignment) return res.status(400).json({ error: "L'enseignant n'a pas d'affectation active pour cette classe et cette matière" });

    try {
      const session = await prisma.$transaction(async (tx) => {
        const [existing, unavailabilities] = await Promise.all([
          tx.timetableSession.findMany({
            where: { yearId: schoolClass.yearId, slot: { weekday: slot.weekday } },
            include: { slot: true },
          }),
          tx.teacherUnavailability.findMany({ where: { teacherId: input.teacherId, weekday: slot.weekday } }),
        ]);
        const candidate: ScheduleSession = {
          id: "new-session",
          classId: input.classId,
          teacherId: input.teacherId,
          roomId: input.roomId,
          dateStart: input.dateStart,
          dateEnd: input.dateEnd ?? null,
          slot,
        };
        const conflicts = findScheduleConflicts(candidate, existing, unavailabilities);
        if (conflicts.length) throw Object.assign(new Error(conflicts.join(" ")), { code: "SCHEDULE_CONFLICT" });
        return tx.timetableSession.create({
          data: { ...input, yearId: schoolClass.yearId, dateEnd: input.dateEnd ?? null },
          include: { class: true, subject: true, teacher: { include: { person: true } }, room: true, slot: true },
        });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      await writeAudit({ userId: auth.sub, action: "TIMETABLE_SESSION_CREATE", entityType: "TIMETABLE_SESSION", entityId: session.id, newValue: session, req });
      res.status(201).json(session);
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "SCHEDULE_CONFLICT") {
        return res.status(409).json({ error: error.message });
      }
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
        return res.status(409).json({ error: "Conflit de planning détecté lors de l'enregistrement. Réessayez." });
      }
      throw error;
    }
  });

  router.get("/attendance", authenticate, requireRole(PersonRole.DIR, PersonRole.CEN, PersonRole.SG, PersonRole.PROF, PersonRole.TIT), async (req, res) => {
    const parsed = z.object({ classId: z.string().uuid(), date: dateOnly }).safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: z.prettifyError(parsed.error) });
    const { classId, date } = parsed.data;
    if (!await canAccessClass(currentAuth(req), classId)) return res.status(403).json({ error: "Cette classe est hors de votre portée" });
    const schoolClass = await prisma.schoolClass.findUnique({ where: { id: classId }, include: { year: true } });
    if (!schoolClass) return res.status(404).json({ error: "Classe introuvable" });
    if (date < schoolClass.year.dateStart || date > schoolClass.year.dateEnd) return res.status(400).json({ error: "La date est hors de l'année scolaire" });
    const [call, enrollments] = await Promise.all([
      prisma.attendanceCall.findUnique({ where: { classId_date: { classId, date } }, include: { entries: true } }),
      activeStudents(classId, schoolClass.yearId, date),
    ]);
    const entriesByStudent = new Map((call?.entries ?? []).map((entry) => [entry.studentId, entry]));
    res.json({
      callId: call?.id ?? null,
      classId,
      date: date.toISOString().slice(0, 10),
      entries: enrollments.map(({ student }) => ({
        studentId: student.id,
        student: { matricule: student.matricule, person: student.person },
        status: entriesByStudent.get(student.id)?.status ?? AttendanceStatus.PRESENT,
        minutesLate: entriesByStudent.get(student.id)?.minutesLate ?? null,
        justification: entriesByStudent.get(student.id)?.justification ?? null,
      })),
    });
  });

  router.put("/attendance", authenticate, requireRole(PersonRole.DIR, PersonRole.CEN, PersonRole.SG, PersonRole.PROF, PersonRole.TIT), async (req, res) => {
    const parsed = z.object({
      classId: z.string().uuid(),
      date: dateOnly,
      entries: z.array(attendanceEntry),
    }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: z.prettifyError(parsed.error) });
    const { classId, date } = parsed.data;
    const auth = currentAuth(req);
    if (!await canAccessClass(auth, classId)) return res.status(403).json({ error: "Cette classe est hors de votre portée" });
    if (new Set(parsed.data.entries.map((entry) => entry.studentId)).size !== parsed.data.entries.length) {
      return res.status(400).json({ error: "Un élève apparaît plusieurs fois dans l'appel" });
    }
    const schoolClass = await prisma.schoolClass.findUnique({ where: { id: classId }, include: { year: true } });
    if (!schoolClass) return res.status(404).json({ error: "Classe introuvable" });
    if (date < schoolClass.year.dateStart || date > schoolClass.year.dateEnd) return res.status(400).json({ error: "La date est hors de l'année scolaire" });
    const enrollments = await activeStudents(classId, schoolClass.yearId, date);
    const validIds = new Set(enrollments.map(({ student }) => student.id));
    if (parsed.data.entries.some((entry) => !validIds.has(entry.studentId))) {
      return res.status(400).json({ error: "L'appel contient un élève qui n'est pas inscrit dans cette classe à cette date" });
    }
    if (parsed.data.entries.some((entry) =>
      (entry.status === AttendanceStatus.RETARD) !== Boolean(entry.minutesLate) ||
      (entry.status !== AttendanceStatus.RETARD && entry.minutesLate !== undefined),
    )) {
      return res.status(400).json({ error: "Le retard exige un nombre de minutes positif ; ce champ est interdit pour les autres statuts" });
    }
    const existing = await prisma.attendanceCall.findUnique({ where: { classId_date: { classId, date } } });
    const call = await prisma.attendanceCall.upsert({
      where: { classId_date: { classId, date } },
      create: { classId, date, calledBy: auth.sub },
      update: { calledBy: auth.sub },
    });
    const inputByStudent = new Map(parsed.data.entries.map((entry) => [entry.studentId, entry]));
    const operations = enrollments.map(({ student }) => {
      const entry = inputByStudent.get(student.id);
      const status = entry?.status ?? AttendanceStatus.PRESENT;
      const minutesLate = status === AttendanceStatus.RETARD ? entry?.minutesLate : null;
      const justification = entry?.justification?.trim() || null;
      return prisma.attendanceEntry.upsert({
        where: { callId_studentId: { callId: call.id, studentId: student.id } },
        create: { callId: call.id, studentId: student.id, status, minutesLate, justification },
        update: { status, minutesLate, justification },
      });
    });
    await prisma.$transaction(operations);
    await writeAudit({ userId: auth.sub, action: "ATTENDANCE_SAVE", entityType: "ATTENDANCE_CALL", entityId: call.id, oldValue: existing, newValue: parsed.data.entries, req });
    res.json({ callId: call.id, classId, date: date.toISOString().slice(0, 10), saved: operations.length });
  });

  router.get("/attendance/summary", authenticate, requireRole(PersonRole.DIR, PersonRole.CEN, PersonRole.SG), async (req, res) => {
    const parsed = z.object({ date: dateOnly }).safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: z.prettifyError(parsed.error) });
    const calls = await prisma.attendanceCall.findMany({
      where: { date: parsed.data.date },
      include: { class: true, entries: true },
      orderBy: { class: { name: "asc" } },
    });
    const accessibleCalls = await Promise.all(calls.map(async (call) =>
      await canAccessClass(currentAuth(req), call.classId) ? call : null,
    ));
    const rows = accessibleCalls.filter((call) => call !== null).map((call) => ({
      classId: call.classId,
      className: call.class.name,
      calledAt: call.updatedAt,
      total: call.entries.length,
      present: call.entries.filter((entry) => entry.status === AttendanceStatus.PRESENT).length,
      absent: call.entries.filter((entry) => entry.status === AttendanceStatus.ABSENT).length,
      late: call.entries.filter((entry) => entry.status === AttendanceStatus.RETARD).length,
      excused: call.entries.filter((entry) => entry.status === AttendanceStatus.EXCUSE).length,
    }));
    res.json({
      date: parsed.data.date.toISOString().slice(0, 10),
      classes: rows,
      totals: rows.reduce((totals, row) => ({
        classes: totals.classes + 1,
        students: totals.students + row.total,
        present: totals.present + row.present,
        absent: totals.absent + row.absent,
        late: totals.late + row.late,
        excused: totals.excused + row.excused,
      }), { classes: 0, students: 0, present: 0, absent: 0, late: 0, excused: 0 }),
    });
  });

  router.get("/textbook", authenticate, async (req, res) => {
    const classId = String(req.query.classId ?? "");
    if (!classId) return res.status(400).json({ error: "La classe est requise" });
    if (!await canAccessClass(currentAuth(req), classId)) return res.status(403).json({ error: "Cette classe est hors de votre portée" });
    const entries = await prisma.textbookEntry.findMany({
      where: { classId },
      include: { subject: true, teacher: { include: { person: true } } },
      orderBy: { date: "desc" },
      take: 100,
    });
    res.json(entries);
  });

  router.post("/textbook", authenticate, requireRole(PersonRole.PROF), async (req, res) => {
    const parsed = z.object({
      classId: z.string().uuid(),
      subjectId: z.string().uuid(),
      sessionId: z.string().uuid().optional(),
      date: dateOnly,
      chapter: z.string().trim().max(200).optional(),
      content: z.string().trim().min(1).max(5000),
      homework: z.string().trim().max(2000).optional(),
      courseHeld: z.boolean(),
    }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: z.prettifyError(parsed.error) });
    const auth = currentAuth(req);
    const schoolClass = await prisma.schoolClass.findUnique({ where: { id: parsed.data.classId }, include: { year: true } });
    if (!schoolClass) return res.status(404).json({ error: "Classe introuvable" });
    if (!await canAccessClass(auth, parsed.data.classId)) return res.status(403).json({ error: "Cette classe est hors de votre portée" });
    const teacher = await assignedTeacher(auth.personId, parsed.data.classId, parsed.data.subjectId, schoolClass.yearId, parsed.data.date);
    if (!teacher) return res.status(403).json({ error: "Vous n'êtes pas affecté à cette classe et cette matière à cette date" });
    if (parsed.data.sessionId) {
      const session = await prisma.timetableSession.findFirst({
        where: {
          id: parsed.data.sessionId,
          classId: parsed.data.classId,
          subjectId: parsed.data.subjectId,
          teacherId: teacher.id,
          dateStart: { lte: parsed.data.date },
          OR: [{ dateEnd: null }, { dateEnd: { gte: parsed.data.date } }],
        },
      });
      if (!session) return res.status(400).json({ error: "La séance ne correspond pas à cette classe, matière et enseignant" });
    }
    const entry = await prisma.textbookEntry.upsert({
      where: { classId_subjectId_teacherId_date: { classId: parsed.data.classId, subjectId: parsed.data.subjectId, teacherId: teacher.id, date: parsed.data.date } },
      create: { ...parsed.data, teacherId: teacher.id, chapter: parsed.data.chapter || null, homework: parsed.data.homework || null },
      update: { ...parsed.data, chapter: parsed.data.chapter || null, homework: parsed.data.homework || null },
    });
    await writeAudit({ userId: auth.sub, action: "TEXTBOOK_ENTRY_SAVE", entityType: "TEXTBOOK_ENTRY", entityId: entry.id, newValue: entry, req });
    res.json(entry);
  });

  router.get("/orientation/campaigns", authenticate, requireRole(PersonRole.DIR, PersonRole.CEN, PersonRole.SEC, PersonRole.TIT, PersonRole.PAR), async (req, res) => {
    const classId = String(req.query.classId ?? "");
    if (!classId) return res.status(400).json({ error: "La classe est requise" });
    const auth = currentAuth(req);
    const isParent = auth.roles.some((role) => role.code === PersonRole.PAR);
    if (isParent) {
      const studentIds = (await prisma.studentGuardian.findMany({
        where: { personId: auth.personId },
        select: { studentId: true },
      })).map((link) => link.studentId);
      if (!studentIds.length) return res.json([]);
      const campaigns = await prisma.orientationCampaign.findMany({
        where: { classId, students: { some: { studentId: { in: studentIds } } } },
        include: {
          students: {
            where: { studentId: { in: studentIds } },
            include: { student: { include: { person: true } } },
          },
        },
        orderBy: { createdAt: "desc" },
      });
      return res.json(campaigns);
    }
    if (!await canAccessClass(auth, classId)) return res.status(403).json({ error: "Cette classe est hors de votre portée" });
    const campaigns = await prisma.orientationCampaign.findMany({
      where: { classId },
      include: { students: { include: { student: { include: { person: true } } }, orderBy: { student: { person: { nom: "asc" } } } } },
      orderBy: { createdAt: "desc" },
    });
    res.json(campaigns);
  });

  router.post("/orientation/campaigns", authenticate, requireRole(PersonRole.DIR, PersonRole.CEN), async (req, res) => {
    const parsed = z.object({ classId: z.string().uuid() }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: z.prettifyError(parsed.error) });
    const auth = currentAuth(req);
    if (!await canAccessClass(auth, parsed.data.classId)) return res.status(403).json({ error: "Cette classe est hors de votre portée" });
    const schoolClass = await prisma.schoolClass.findUnique({
      where: { id: parsed.data.classId },
      include: { year: true, pathway: { include: { level: true, filiere: true } } },
    });
    if (!schoolClass) return res.status(404).json({ error: "Classe introuvable" });
    const existingCampaign = await prisma.orientationCampaign.findUnique({
      where: { yearId_classId: { yearId: schoolClass.yearId, classId: schoolClass.id } },
    });
    if (existingCampaign) return res.status(409).json({ error: "Une campagne existe déjà pour cette classe et cette année" });
    const enrollments = await activeStudents(schoolClass.id, schoolClass.yearId, schoolClass.year.dateEnd);
    const currentPath = schoolClass.pathway.label;
    const provisionalOrientation = /\b2nde\s+S\b/i.test(currentPath) ? "1ère D"
      : /\b2nde\s+A4\b/i.test(currentPath) ? "1ère A4"
        : /\b1ère\b/i.test(currentPath) ? `Terminale ${schoolClass.pathway.filiere?.label ?? currentPath.replace(/^1ère\s*/i, "")}`
          : null;
    const campaign = await prisma.orientationCampaign.create({
      data: {
        classId: schoolClass.id,
        yearId: schoolClass.yearId,
        createdBy: auth.sub,
        students: {
          create: enrollments.map(({ student, type }) => ({
            studentId: student.id,
            provisionalOrientation: type === "REDOUBLANT" ? currentPath : provisionalOrientation,
          })),
        },
      },
      include: { students: { include: { student: { include: { person: true } } } } },
    });
    await writeAudit({ userId: auth.sub, action: "ORIENTATION_CAMPAIGN_CREATE", entityType: "ORIENTATION_CAMPAIGN", entityId: campaign.id, newValue: campaign, req });
    res.status(201).json(campaign);
  });

  router.patch("/orientation/campaigns/:id/status", authenticate, requireRole(PersonRole.DIR, PersonRole.CEN), async (req, res) => {
    const parsed = z.object({ status: z.nativeEnum(OrientationStatus) }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: z.prettifyError(parsed.error) });
    const campaign = await prisma.orientationCampaign.findUnique({
      where: { id: String(req.params.id) },
      include: { class: { include: { pathway: { include: { level: true } } } } },
    });
    if (!campaign) return res.status(404).json({ error: "Campagne introuvable" });
    if (!await canAccessClass(currentAuth(req), campaign.classId)) return res.status(403).json({ error: "Cette classe est hors de votre portée" });
    if (campaign.status === OrientationStatus.BROUILLON && parsed.data.status !== OrientationStatus.OUVERTE ||
      campaign.status === OrientationStatus.OUVERTE && parsed.data.status !== OrientationStatus.CLOTUREE ||
      campaign.status === OrientationStatus.CLOTUREE) {
      return res.status(409).json({ error: "Transition de campagne non autorisée" });
    }
    const updated = await prisma.orientationCampaign.update({ where: { id: campaign.id }, data: { status: parsed.data.status } });
    await writeAudit({ userId: currentAuth(req).sub, action: "ORIENTATION_CAMPAIGN_STATUS", entityType: "ORIENTATION_CAMPAIGN", entityId: campaign.id, oldValue: campaign.status, newValue: updated.status, req });
    res.json(updated);
  });

  router.put("/orientation/campaigns/:id/students/:studentId", authenticate, async (req, res) => {
    const auth = currentAuth(req);
    const isParent = auth.roles.some((role) => role.code === PersonRole.PAR);
    const campaign = await prisma.orientationCampaign.findUnique({
      where: { id: String(req.params.id) },
      include: { class: { include: { pathway: { include: { level: true } } } } },
    });
    if (!campaign) return res.status(404).json({ error: "Campagne introuvable" });
    if (!isParent && !await canAccessClass(auth, campaign.classId)) return res.status(403).json({ error: "Cette classe est hors de votre portée" });
    const orientationEditorRoles: PersonRole[] = [PersonRole.DIR, PersonRole.CEN, PersonRole.TIT];
    if (!isParent && !auth.roles.some((role) => orientationEditorRoles.includes(role.code))) {
      return res.status(403).json({ error: "Accès refusé aux avis du conseil d'orientation" });
    }
    const studentId = String(req.params.studentId);
    const current = await prisma.orientationStudent.findUnique({
      where: { campaignId_studentId: { campaignId: campaign.id, studentId } },
    });
    if (!current) return res.status(404).json({ error: "Élève absent de cette campagne" });

    let update: Prisma.OrientationStudentUpdateInput = {};
    if (isParent) {
      if (campaign.status !== OrientationStatus.OUVERTE) return res.status(409).json({ error: "La campagne n'est pas ouverte aux familles" });
      const guardianLink = await prisma.studentGuardian.findUnique({ where: { studentId_personId: { studentId, personId: auth.personId } } });
      if (!guardianLink) return res.status(403).json({ error: "Vous n'êtes pas responsable légal de cet élève" });
      const allowedChoices = campaign.class.pathway.level.code === "3E"
        ? [OrientationChoice.D, OrientationChoice.A4]
        : Object.values(OrientationChoice);
      const familyChoice = z.enum(allowedChoices as [OrientationChoice, ...OrientationChoice[]]);
      const parsed = z.object({ familyFirst: familyChoice, familySecond: familyChoice.nullable() }).safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: z.prettifyError(parsed.error) });
      if (parsed.data.familySecond === parsed.data.familyFirst) return res.status(400).json({ error: "Les deux choix doivent être différents" });
      update = parsed.data;
    } else {
      const parsed = z.object({
        councilOpinion: z.enum(campaign.class.pathway.level.code === "3E"
          ? [OrientationChoice.D, OrientationChoice.A4]
          : Object.values(OrientationChoice) as [OrientationChoice, ...OrientationChoice[]]).optional(),
        finalDecision: z.enum(campaign.class.pathway.level.code === "3E"
          ? [OrientationChoice.D, OrientationChoice.A4]
          : Object.values(OrientationChoice) as [OrientationChoice, ...OrientationChoice[]]).optional(),
        meanMaths: z.number().min(0).max(20).nullable().optional(),
        meanPhysics: z.number().min(0).max(20).nullable().optional(),
        meanBiology: z.number().min(0).max(20).nullable().optional(),
      }).refine((data) => Object.keys(data).length > 0).safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: z.prettifyError(parsed.error) });
      const hasFinalDecision = parsed.data.finalDecision !== undefined;
      if (hasFinalDecision && !auth.roles.some((role) => role.code === PersonRole.DIR)) {
        return res.status(403).json({ error: "Seule la direction peut enregistrer la décision définitive" });
      }
      if (hasFinalDecision && campaign.status !== OrientationStatus.CLOTUREE) {
        return res.status(409).json({ error: "Clôturez la campagne avant d'enregistrer une décision définitive" });
      }
      if (campaign.status === OrientationStatus.CLOTUREE && !hasFinalDecision) {
        return res.status(409).json({ error: "La campagne est clôturée" });
      }
      update = {
        ...parsed.data,
        ...(parsed.data.meanMaths === undefined ? {} : { meanMaths: parsed.data.meanMaths === null ? null : new Prisma.Decimal(parsed.data.meanMaths) }),
        ...(parsed.data.meanPhysics === undefined ? {} : { meanPhysics: parsed.data.meanPhysics === null ? null : new Prisma.Decimal(parsed.data.meanPhysics) }),
        ...(parsed.data.meanBiology === undefined ? {} : { meanBiology: parsed.data.meanBiology === null ? null : new Prisma.Decimal(parsed.data.meanBiology) }),
      };
    }
    const updated = await prisma.orientationStudent.update({ where: { id: current.id }, data: update });
    await writeAudit({ userId: auth.sub, action: "ORIENTATION_STUDENT_UPDATE", entityType: "ORIENTATION_STUDENT", entityId: current.id, oldValue: current, newValue: updated, req });
    res.json(updated);
  });

  router.get("/council-meetings", authenticate, requireRole(PersonRole.DIR, PersonRole.CEN, PersonRole.TIT), async (req, res) => {
    const classId = String(req.query.classId ?? "");
    if (!classId) return res.status(400).json({ error: "La classe est requise" });
    if (!await canAccessClass(currentAuth(req), classId)) return res.status(403).json({ error: "Cette classe est hors de votre portée" });
    const meetings = await prisma.councilMeeting.findMany({
      where: { classId },
      include: { decisions: { include: { student: { include: { person: true, reportCards: { where: { classId } } } } } } },
      orderBy: { createdAt: "desc" },
    });
    res.json(meetings);
  });

  router.post("/council-meetings", authenticate, requireRole(PersonRole.DIR, PersonRole.CEN), async (req, res) => {
    const parsed = z.object({ classId: z.string().uuid(), periodId: z.string().uuid().optional() }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: z.prettifyError(parsed.error) });
    const auth = currentAuth(req);
    if (!await canAccessClass(auth, parsed.data.classId)) return res.status(403).json({ error: "Cette classe est hors de votre portée" });
    const schoolClass = await prisma.schoolClass.findUnique({ where: { id: parsed.data.classId }, include: { year: true } });
    if (!schoolClass) return res.status(404).json({ error: "Classe introuvable" });
    if (parsed.data.periodId && !await prisma.period.findFirst({ where: { id: parsed.data.periodId, yearId: schoolClass.yearId } })) {
      return res.status(400).json({ error: "La période ne correspond pas à l'année de la classe" });
    }
    const meeting = await prisma.councilMeeting.create({
      data: {
        yearId: schoolClass.yearId,
        classId: schoolClass.id,
        periodId: parsed.data.periodId,
        createdBy: auth.sub,
        decisions: {
          create: (await activeStudents(schoolClass.id, schoolClass.yearId, schoolClass.year.dateEnd)).map(({ student }) => ({
            studentId: student.id,
            decision: "A_DEFINIR",
          })),
        },
      },
      include: {
        decisions: {
          include: {
            student: {
              include: { person: true, reportCards: { where: { classId: schoolClass.id } } },
            },
          },
        },
      },
    });
    await writeAudit({ userId: auth.sub, action: "COUNCIL_MEETING_CREATE", entityType: "COUNCIL_MEETING", entityId: meeting.id, newValue: meeting, req });
    res.status(201).json(meeting);
  });

  router.put("/council-meetings/:id", authenticate, requireRole(PersonRole.DIR, PersonRole.CEN), async (req, res) => {
    const parsed = z.object({
      status: z.nativeEnum(CouncilStatus).optional(),
      minutes: z.string().trim().max(20000).nullable().optional(),
      heldAt: z.coerce.date().nullable().optional(),
      decisions: z.array(z.object({
        studentId: z.string().uuid(),
        decision: z.enum(["PASSAGE", "REDOUBLEMENT", "ORIENTATION", "A_DEFINIR"]),
        proposal: z.string().trim().max(300).optional(),
        comment: z.string().trim().max(2000).optional(),
      })).optional(),
    }).refine((data) => Object.keys(data).length > 0).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: z.prettifyError(parsed.error) });
    const meeting = await prisma.councilMeeting.findUnique({ where: { id: String(req.params.id) } });
    if (!meeting) return res.status(404).json({ error: "Conseil de classe introuvable" });
    if (!await canAccessClass(currentAuth(req), meeting.classId)) return res.status(403).json({ error: "Cette classe est hors de votre portée" });
    if (meeting.status === CouncilStatus.ARCHIVE) return res.status(409).json({ error: "Le procès-verbal archivé ne peut plus être modifié" });
    if (parsed.data.status === CouncilStatus.ARCHIVE && !meeting.minutes?.trim() && !parsed.data.minutes?.trim()) {
      return res.status(409).json({ error: "Saisissez le procès-verbal avant d'archiver le conseil" });
    }
    const entries = parsed.data.decisions;
    if (entries) {
      if (new Set(entries.map((entry) => entry.studentId)).size !== entries.length) return res.status(400).json({ error: "Un élève apparaît plusieurs fois" });
      const enrolledIds = new Set((await activeStudents(meeting.classId, meeting.yearId, new Date())).map(({ student }) => student.id));
      if (entries.some((entry) => !enrolledIds.has(entry.studentId))) return res.status(400).json({ error: "Une décision concerne un élève hors de la classe" });
    }
    const updated = await prisma.$transaction(async (tx) => {
      if (entries) {
        for (const entry of entries) {
          await tx.councilDecision.upsert({
            where: { meetingId_studentId: { meetingId: meeting.id, studentId: entry.studentId } },
            create: { meetingId: meeting.id, ...entry },
            update: { decision: entry.decision, proposal: entry.proposal, comment: entry.comment },
          });
        }
      }
      return tx.councilMeeting.update({
        where: { id: meeting.id },
        data: {
          ...(parsed.data.status ? { status: parsed.data.status } : {}),
          ...(parsed.data.minutes !== undefined ? { minutes: parsed.data.minutes } : {}),
          ...(parsed.data.heldAt !== undefined ? { heldAt: parsed.data.heldAt } : {}),
        },
        include: {
          decisions: {
            include: {
              student: {
                include: { person: true, reportCards: { where: { classId: meeting.classId } } },
              },
            },
          },
        },
      });
    });
    await writeAudit({ userId: currentAuth(req).sub, action: "COUNCIL_MEETING_UPDATE", entityType: "COUNCIL_MEETING", entityId: meeting.id, oldValue: meeting, newValue: updated, req });
    res.json(updated);
  });

  router.get("/discipline/scales", authenticate, requireRole(PersonRole.DIR, PersonRole.CEN, PersonRole.SG, PersonRole.PROF, PersonRole.TIT), async (_req, res) => {
    res.json(await prisma.disciplineScale.findMany({ where: { active: true }, orderBy: [{ points: "asc" }, { label: "asc" }] }));
  });

  router.post("/discipline/scales", authenticate, requireRole(PersonRole.DIR, PersonRole.CEN, PersonRole.SG), async (req, res) => {
    const parsed = z.object({
      code: z.string().trim().min(2).max(40).regex(/^[A-Z0-9_-]+$/),
      label: z.string().trim().min(2).max(120),
      points: z.number().int().min(0).max(1000),
    }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: z.prettifyError(parsed.error) });
    if (await prisma.disciplineScale.findUnique({ where: { code: parsed.data.code } })) {
      return res.status(409).json({ error: "Ce code de barème existe déjà" });
    }
    const scale = await prisma.disciplineScale.create({ data: parsed.data });
    await writeAudit({ userId: currentAuth(req).sub, action: "DISCIPLINE_SCALE_CREATE", entityType: "DISCIPLINE_SCALE", entityId: scale.id, newValue: scale, req });
    res.status(201).json(scale);
  });

  router.get("/discipline/incidents", authenticate, requireRole(PersonRole.DIR, PersonRole.CEN, PersonRole.SG, PersonRole.PROF, PersonRole.TIT), async (req, res) => {
    const classId = String(req.query.classId ?? "");
    if (!classId) return res.status(400).json({ error: "La classe est requise" });
    if (!await canAccessClass(currentAuth(req), classId)) return res.status(403).json({ error: "Cette classe est hors de votre portée" });
    const incidents = await prisma.disciplineIncident.findMany({
      where: { classId },
      include: { student: { include: { person: true } }, scale: true, followUps: true },
      orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }],
      take: 200,
    });
    res.json(incidents);
  });

  router.post("/discipline/incidents", authenticate, requireRole(PersonRole.DIR, PersonRole.CEN, PersonRole.SG, PersonRole.PROF, PersonRole.TIT), async (req, res) => {
    const parsed = z.object({
      classId: z.string().uuid(),
      studentId: z.string().uuid(),
      category: z.string().trim().min(2).max(100),
      description: z.string().trim().min(5).max(5000),
      occurredAt: z.coerce.date(),
      evidenceRef: z.string().trim().max(500).optional(),
      disciplineCouncilRequired: z.boolean().default(false),
    }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: z.prettifyError(parsed.error) });
    const auth = currentAuth(req);
    if (!await canAccessClass(auth, parsed.data.classId)) return res.status(403).json({ error: "Cette classe est hors de votre portée" });
    const schoolClass = await prisma.schoolClass.findUnique({ where: { id: parsed.data.classId }, include: { year: true } });
    if (!schoolClass) return res.status(404).json({ error: "Classe introuvable" });
    if (parsed.data.occurredAt < schoolClass.year.dateStart || parsed.data.occurredAt > schoolClass.year.dateEnd) {
      return res.status(400).json({ error: "La date de l'incident est hors de l'année scolaire" });
    }
    const enrollment = await prisma.enrollment.findFirst({
      where: {
        studentId: parsed.data.studentId,
        classId: schoolClass.id,
        yearId: schoolClass.yearId,
        status: "ACTIVE",
        dateStart: { lte: parsed.data.occurredAt },
        OR: [{ dateEnd: null }, { dateEnd: { gte: parsed.data.occurredAt } }],
      },
    });
    if (!enrollment) return res.status(400).json({ error: "L'élève n'est pas inscrit dans cette classe à cette date" });
    const incident = await prisma.disciplineIncident.create({
      data: { ...parsed.data, reportedBy: auth.sub },
      include: { student: { include: { person: true } } },
    });
    await writeAudit({ userId: auth.sub, action: "DISCIPLINE_INCIDENT_REPORT", entityType: "DISCIPLINE_INCIDENT", entityId: incident.id, newValue: incident, req });
    res.status(201).json(incident);
  });

  router.put("/discipline/incidents/:id/decision", authenticate, requireRole(PersonRole.DIR, PersonRole.SG), async (req, res) => {
    const parsed = z.object({
      scaleId: z.string().uuid().nullable().optional(),
      decision: z.string().trim().min(2).max(2000),
      disciplineCouncilRequired: z.boolean().optional(),
      disciplineCouncilAt: z.coerce.date().nullable().optional(),
    }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: z.prettifyError(parsed.error) });
    const incident = await prisma.disciplineIncident.findUnique({ where: { id: String(req.params.id) } });
    if (!incident) return res.status(404).json({ error: "Incident introuvable" });
    if (!await canAccessClass(currentAuth(req), incident.classId)) return res.status(403).json({ error: "Cette classe est hors de votre portée" });
    if (!canTransitionIncident(incident.status, DisciplineIncidentStatus.DECIDE)) return res.status(409).json({ error: "Cet incident ne peut plus recevoir de décision" });
    if (parsed.data.scaleId && !await prisma.disciplineScale.findFirst({ where: { id: parsed.data.scaleId, active: true } })) {
      return res.status(400).json({ error: "Le barème sélectionné est introuvable ou inactif" });
    }
    const updated = await prisma.disciplineIncident.update({
      where: { id: incident.id },
      data: {
        status: DisciplineIncidentStatus.DECIDE,
        scaleId: parsed.data.scaleId ?? null,
        decision: parsed.data.decision,
        decidedBy: currentAuth(req).sub,
        decidedAt: new Date(),
        ...(parsed.data.disciplineCouncilRequired === undefined ? {} : { disciplineCouncilRequired: parsed.data.disciplineCouncilRequired }),
        ...(parsed.data.disciplineCouncilAt === undefined ? {} : { disciplineCouncilAt: parsed.data.disciplineCouncilAt }),
      },
      include: { student: { include: { person: true } }, scale: true },
    });
    await writeAudit({ userId: currentAuth(req).sub, action: "DISCIPLINE_INCIDENT_DECIDE", entityType: "DISCIPLINE_INCIDENT", entityId: incident.id, oldValue: incident, newValue: updated, req });
    res.json(updated);
  });

  router.post("/discipline/incidents/:id/notify-parent", authenticate, requireRole(PersonRole.DIR, PersonRole.SG), async (req, res) => {
    const incident = await prisma.disciplineIncident.findUnique({ where: { id: String(req.params.id) } });
    if (!incident) return res.status(404).json({ error: "Incident introuvable" });
    if (!await canAccessClass(currentAuth(req), incident.classId)) return res.status(403).json({ error: "Cette classe est hors de votre portée" });
    if (!canTransitionIncident(incident.status, DisciplineIncidentStatus.NOTIFIE)) return res.status(409).json({ error: "La décision doit être enregistrée avant la notification aux parents" });
    const updated = await prisma.disciplineIncident.update({
      where: { id: incident.id },
      data: { status: DisciplineIncidentStatus.NOTIFIE, parentNotifiedAt: new Date() },
    });
    await writeAudit({ userId: currentAuth(req).sub, action: "DISCIPLINE_PARENT_NOTIFIED", entityType: "DISCIPLINE_INCIDENT", entityId: incident.id, oldValue: incident.status, newValue: updated.status, req });
    res.json(updated);
  });

  router.post("/discipline/incidents/:id/close", authenticate, requireRole(PersonRole.DIR, PersonRole.SG), async (req, res) => {
    const incident = await prisma.disciplineIncident.findUnique({ where: { id: String(req.params.id) } });
    if (!incident) return res.status(404).json({ error: "Incident introuvable" });
    if (!await canAccessClass(currentAuth(req), incident.classId)) return res.status(403).json({ error: "Cette classe est hors de votre portée" });
    if (!canTransitionIncident(incident.status, DisciplineIncidentStatus.CLOTURE)) return res.status(409).json({ error: "L'incident doit être notifié avant sa clôture" });
    const updated = await prisma.disciplineIncident.update({
      where: { id: incident.id },
      data: { status: DisciplineIncidentStatus.CLOTURE, closedAt: new Date() },
    });
    await writeAudit({ userId: currentAuth(req).sub, action: "DISCIPLINE_INCIDENT_CLOSE", entityType: "DISCIPLINE_INCIDENT", entityId: incident.id, oldValue: incident.status, newValue: updated.status, req });
    res.json(updated);
  });

  router.get("/discipline/follow-ups", authenticate, requireRole(PersonRole.DIR, PersonRole.CEN, PersonRole.SG, PersonRole.PROF, PersonRole.TIT), async (req, res) => {
    const classId = String(req.query.classId ?? "");
    if (!classId) return res.status(400).json({ error: "La classe est requise" });
    if (!await canAccessClass(currentAuth(req), classId)) return res.status(403).json({ error: "Cette classe est hors de votre portée" });
    res.json(await prisma.studentFollowUp.findMany({
      where: { classId },
      include: { student: { include: { person: true } }, incident: true },
      orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }],
      take: 200,
    }));
  });

  router.post("/discipline/follow-ups", authenticate, requireRole(PersonRole.DIR, PersonRole.CEN, PersonRole.SG, PersonRole.PROF, PersonRole.TIT), async (req, res) => {
    const parsed = z.object({
      classId: z.string().uuid(),
      studentId: z.string().uuid(),
      incidentId: z.string().uuid().nullable().optional(),
      kind: z.nativeEnum(StudentFollowUpKind),
      occurredAt: z.coerce.date(),
      summary: z.string().trim().min(5).max(5000),
      parentContact: z.string().trim().max(1000).optional(),
    }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: z.prettifyError(parsed.error) });
    const auth = currentAuth(req);
    if (!await canAccessClass(auth, parsed.data.classId)) return res.status(403).json({ error: "Cette classe est hors de votre portée" });
    const schoolClass = await prisma.schoolClass.findUnique({ where: { id: parsed.data.classId }, include: { year: true } });
    if (!schoolClass) return res.status(404).json({ error: "Classe introuvable" });
    if (parsed.data.occurredAt < schoolClass.year.dateStart || parsed.data.occurredAt > schoolClass.year.dateEnd) {
      return res.status(400).json({ error: "La date du suivi est hors de l'année scolaire" });
    }
    const enrollment = await prisma.enrollment.findFirst({
      where: {
        studentId: parsed.data.studentId,
        classId: schoolClass.id,
        yearId: schoolClass.yearId,
        status: "ACTIVE",
        dateStart: { lte: parsed.data.occurredAt },
        OR: [{ dateEnd: null }, { dateEnd: { gte: parsed.data.occurredAt } }],
      },
    });
    if (!enrollment) return res.status(400).json({ error: "L'élève n'est pas inscrit dans cette classe à cette date" });
    if (parsed.data.incidentId) {
      const incident = await prisma.disciplineIncident.findFirst({
        where: { id: parsed.data.incidentId, studentId: parsed.data.studentId, classId: schoolClass.id },
      });
      if (!incident) return res.status(400).json({ error: "L'incident associé ne correspond pas à cet élève et cette classe" });
    }
    const followUp = await prisma.studentFollowUp.create({
      data: { ...parsed.data, incidentId: parsed.data.incidentId ?? null, createdBy: auth.sub },
      include: { student: { include: { person: true } } },
    });
    await writeAudit({ userId: auth.sub, action: "STUDENT_FOLLOW_UP_CREATE", entityType: "STUDENT_FOLLOW_UP", entityId: followUp.id, newValue: followUp, req });
    res.status(201).json(followUp);
  });

  return router;
}
