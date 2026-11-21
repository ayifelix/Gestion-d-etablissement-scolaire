export function assertDateRange(dateStart: Date, dateEnd?: Date) {
  if (dateEnd && dateEnd < dateStart) {
    throw new Error("La date de fin précède la date de début");
  }
}

export function overlaps(
  firstStart: Date,
  firstEnd: Date | null | undefined,
  secondStart: Date,
  secondEnd: Date | null | undefined,
) {
  const firstFinish = firstEnd ?? new Date("2099-12-31T00:00:00.000Z");
  const secondFinish = secondEnd ?? new Date("2099-12-31T00:00:00.000Z");
  return firstStart <= secondFinish && secondStart <= firstFinish;
}

export function buildMatricule(label: string, sequence: number) {
  const normalized = label.replace(/[^A-Za-z0-9]/g, "");
  return `EL-${normalized || "NOYEAR"}-${String(sequence).padStart(6, "0")}`;
}

export function validateMark(
  status: "NOTE" | "ABSENT_JUSTIFIE" | "ABSENT_NON_JUSTIFIE" | "DISPENSE" | "NON_NOTE",
  value: number | undefined,
  maxScore: number,
) {
  if (status === "NOTE" && value === undefined) {
    throw new Error("Une valeur est obligatoire pour une note");
  }
  if (status !== "NOTE" && value !== undefined) {
    throw new Error("Une absence ou dispense ne peut pas être enregistrée comme une note");
  }
  if (value !== undefined && (value < 0 || value > maxScore)) {
    throw new Error(`La note doit être comprise entre 0 et ${maxScore}`);
  }
}
