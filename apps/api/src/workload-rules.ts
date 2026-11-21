export function roundHours(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function hoursBetweenMinutes(startMinute: number, endMinute: number) {
  return roundHours((endMinute - startMinute) / 60);
}

export function countWeekdayOccurrences(start: Date, end: Date, weekday: number) {
  if (!Number.isInteger(weekday) || weekday < 1 || weekday > 6) return 0;
  const first = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate());
  const last = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate());
  if (last < first) return 0;

  let count = 0;
  for (let day = first; day <= last; day += 24 * 60 * 60 * 1000) {
    const jsWeekday = new Date(day).getUTCDay();
    const schoolWeekday = jsWeekday === 0 ? 7 : jsWeekday;
    if (schoolWeekday === weekday) count++;
  }
  return count;
}

export function projectWeeklyHours(weeklyHours: number, start: Date, end: Date) {
  const first = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate());
  const last = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate());
  if (last < first) return 0;
  const activeDays = Math.floor((last - first) / (24 * 60 * 60 * 1000)) + 1;
  return roundHours(weeklyHours * activeDays / 7);
}

export function calculateOvertimeHours(performedHours: number, plannedHours: number) {
  return roundHours(Math.max(0, performedHours - plannedHours));
}

export function exceedsAssignmentHours(assignmentWeeklyHours: number, scheduledWeeklyHours: number) {
  return scheduledWeeklyHours > assignmentWeeklyHours + 0.01;
}
