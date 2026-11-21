import assert from "node:assert/strict";
import test from "node:test";
import { dateRangesOverlap, findScheduleConflicts } from "../src/j3-rules";

const date = (value: string) => new Date(`${value}T00:00:00.000Z`);
const candidate = {
  id: "new",
  classId: "class-1",
  teacherId: "teacher-1",
  roomId: "room-1",
  dateStart: date("2026-09-01"),
  dateEnd: null,
  slot: { id: "slot-1", weekday: 1, startMinute: 480, endMinute: 525 },
};

test("les créneaux adjacents et les périodes sans chevauchement sont valides", () => {
  assert.equal(dateRangesOverlap(date("2026-09-01"), date("2026-12-31"), date("2027-01-01"), null), false);
  assert.deepEqual(findScheduleConflicts(candidate, [{
    ...candidate,
    id: "old",
    classId: "other",
    teacherId: "other",
    roomId: "other",
    slot: { ...candidate.slot, startMinute: 525, endMinute: 570 },
  }], []), []);
});

test("les conflits de classe, enseignant, salle et indisponibilité sont bloquants", () => {
  const conflicts = findScheduleConflicts(candidate, [{
    ...candidate,
    id: "old",
  }], [{
    teacherId: candidate.teacherId,
    weekday: 1,
    startMinute: 500,
    endMinute: 550,
    dateStart: null,
    dateEnd: null,
  }]);
  assert.equal(conflicts.length, 4);
});
