export type IncidentStatus = "SIGNALE" | "DECIDE" | "NOTIFIE" | "CLOTURE";

const incidentTransitions: Record<IncidentStatus, IncidentStatus[]> = {
  SIGNALE: ["DECIDE"],
  DECIDE: ["NOTIFIE"],
  NOTIFIE: ["CLOTURE"],
  CLOTURE: [],
};

export function canTransitionIncident(current: IncidentStatus, next: IncidentStatus) {
  return incidentTransitions[current].includes(next);
}
