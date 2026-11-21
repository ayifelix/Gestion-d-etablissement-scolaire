export type GradedSubjectInput = {
  subjectId: string;
  label: string;
  coefficient: number;
  classworkScores: number[];
  compositionScores: number[];
};

export type GradingWeights = {
  classwork: number;
  composition: number;
  roundingDigits: number;
};

export type SubjectResult = {
  subjectId: string;
  label: string;
  coefficient: number;
  average: number | null;
};

export function roundTo(value: number, digits: number) {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function average(values: number[]) {
  return values.length ? values.reduce((total, value) => total + value, 0) / values.length : null;
}

export function calculateSubjectAverages(
  subjects: GradedSubjectInput[],
  weights: GradingWeights,
): SubjectResult[] {
  if (weights.classwork < 0 || weights.composition < 0 ||
      weights.classwork + weights.composition <= 0 ||
      weights.roundingDigits < 0 || weights.roundingDigits > 4) {
    throw new Error("Les paramètres de calcul sont invalides");
  }

  const totalWeight = weights.classwork + weights.composition;
  return subjects.map((subject) => {
    const classwork = average(subject.classworkScores);
    const composition = average(subject.compositionScores);
    const result = classwork === null || composition === null
      ? null
      : roundTo(
          (classwork * weights.classwork + composition * weights.composition) / totalWeight,
          weights.roundingDigits,
        );
    return {
      subjectId: subject.subjectId,
      label: subject.label,
      coefficient: subject.coefficient,
      average: result,
    };
  });
}

export function calculateWeightedAverage(subjects: SubjectResult[], digits: number) {
  const evaluated = subjects.filter((subject) => subject.average !== null && subject.coefficient > 0);
  const coefficients = evaluated.reduce((total, subject) => total + subject.coefficient, 0);
  if (!coefficients) return null;
  return roundTo(
    evaluated.reduce((total, subject) => total + subject.average! * subject.coefficient, 0) / coefficients,
    digits,
  );
}

export function assignCompetitionRanks<T extends { average: number | null }>(rows: T[]) {
  const sorted = [...rows].sort((a, b) => {
    if (a.average === null) return b.average === null ? 0 : 1;
    if (b.average === null) return -1;
    return b.average - a.average;
  });
  let previous: number | null = null;
  let rank = 0;
  return sorted.map((row, index) => {
    if (row.average !== null && row.average !== previous) rank = index + 1;
    previous = row.average;
    return { ...row, rank: row.average === null ? null : rank };
  });
}

export function calculateAnnualAverage(periods: Array<number | null>, weights: number[], digits: number) {
  if (periods.length !== weights.length || weights.some((weight) => weight < 0)) {
    throw new Error("Les pondérations annuelles sont invalides");
  }
  const evaluated = periods.flatMap((value, index) =>
    value === null || weights[index] === 0 ? [] : [{ value, weight: weights[index] }],
  );
  const totalWeight = evaluated.reduce((total, item) => total + item.weight, 0);
  if (!totalWeight) return null;
  return roundTo(
    evaluated.reduce((total, item) => total + item.value * item.weight, 0) / totalWeight,
    digits,
  );
}
