export type ScheduleSlot = {
  id: string;
  weekday: number;
  startMinute: number;
  endMinute: number;
};

export type ScheduleSession = {
  id: string;
  classId: string;
  teacherId: string;
  roomId: string;
  dateStart: Date;
  dateEnd: Date | null;
  slot: ScheduleSlot;
};

export type TeacherUnavailability = {
  teacherId: string;
  weekday: number;
  startMinute: number;
  endMinute: number;
  dateStart: Date | null;
  dateEnd: Date | null;
};

export function timeOverlaps(aStart: number, aEnd: number, bStart: number, bEnd: number) {
  return aStart < bEnd && bStart < aEnd;
}

export function dateRangesOverlap(
  aStart: Date,
  aEnd: Date | null,
  bStart: Date | null,
  bEnd: Date | null,
) {
  return (!aEnd || !bStart || bStart <= aEnd) && (!bEnd || aStart <= bEnd);
}

export function findScheduleConflicts(
  candidate: ScheduleSession,
  existing: ScheduleSession[],
  unavailabilities: TeacherUnavailability[],
) {
  const conflicts: string[] = [];
  for (const session of existing) {
    if (session.id === candidate.id || session.slot.weekday !== candidate.slot.weekday) continue;
    if (!timeOverlaps(
      candidate.slot.startMinute,
      candidate.slot.endMinute,
      session.slot.startMinute,
      session.slot.endMinute,
    )) continue;
    if (!dateRangesOverlap(candidate.dateStart, candidate.dateEnd, session.dateStart, session.dateEnd)) continue;
    if (session.classId === candidate.classId) conflicts.push("La classe a déjà un cours à ce créneau.");
    if (session.teacherId === candidate.teacherId) conflicts.push("L'enseignant est déjà affecté à ce créneau.");
    if (session.roomId === candidate.roomId) conflicts.push("La salle est déjà réservée à ce créneau.");
  }
  for (const unavailable of unavailabilities) {
    if (unavailable.teacherId !== candidate.teacherId || unavailable.weekday !== candidate.slot.weekday) continue;
    if (!timeOverlaps(
      candidate.slot.startMinute,
      candidate.slot.endMinute,
      unavailable.startMinute,
      unavailable.endMinute,
    )) continue;
    if (dateRangesOverlap(candidate.dateStart, candidate.dateEnd, unavailable.dateStart, unavailable.dateEnd)) {
      conflicts.push("L'enseignant est indisponible sur cette plage.");
    }
  }
  return [...new Set(conflicts)];
}
