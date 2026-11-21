import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateOvertimeHours,
  countWeekdayOccurrences,
  exceedsAssignmentHours,
  hoursBetweenMinutes,
  projectWeeklyHours,
} from "../src/workload-rules";

const date = (value: string) => new Date(`${value}T00:00:00.000Z`);

test("les heures prévues suivent les dates actives et les occurrences hebdomadaires", () => {
  assert.equal(projectWeeklyHours(14, date("2026-11-02"), date("2026-11-08")), 14);
  assert.equal(countWeekdayOccurrences(date("2026-11-02"), date("2026-11-08"), 1), 1);
  assert.equal(countWeekdayOccurrences(date("2026-11-02"), date("2026-11-08"), 7), 0);
});

test("les durées d'emploi du temps sont calculées en heures décimales", () => {
  assert.equal(hoursBetweenMinutes(480, 525), 0.75);
  assert.equal(projectWeeklyHours(10, date("2026-11-08"), date("2026-11-01")), 0);
});

test("les dépassements restent positifs et les alertes suivent l'affectation", () => {
  assert.equal(calculateOvertimeHours(18, 16), 2);
  assert.equal(calculateOvertimeHours(12, 16), 0);
  assert.equal(exceedsAssignmentHours(18, 18.02), true);
  assert.equal(exceedsAssignmentHours(18, 18), false);
});
