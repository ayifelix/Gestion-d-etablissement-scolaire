import test from "node:test";
import assert from "node:assert/strict";
import {
  assignCompetitionRanks,
  calculateAnnualAverage,
  calculateSubjectAverages,
  calculateWeightedAverage,
} from "../src/grading";

test("calcule les moyennes selon la formule du cahier des charges", () => {
  const subjects = calculateSubjectAverages([
    { subjectId: "math", label: "Mathématiques", coefficient: 4, classworkScores: [12, 16], compositionScores: [14] },
    { subjectId: "fr", label: "Français", coefficient: 3, classworkScores: [10], compositionScores: [12] },
    { subjectId: "svt", label: "SVT", coefficient: 2, classworkScores: [18], compositionScores: [] },
  ], { classwork: 1, composition: 1, roundingDigits: 2 });

  assert.deepEqual(subjects.map((subject) => subject.average), [14, 11, null]);
  assert.equal(calculateWeightedAverage(subjects, 2), 12.71);
});

test("garde les ex aequo au même rang et exclut une moyenne manquante", () => {
  const ranked = assignCompetitionRanks([
    { id: "a", average: 15 },
    { id: "b", average: 15 },
    { id: "c", average: 12 },
    { id: "d", average: null },
  ]);
  assert.deepEqual(ranked.map(({ id, rank }) => [id, rank]), [
    ["a", 1], ["b", 1], ["c", 3], ["d", null],
  ]);
});

test("calcule la moyenne annuelle avec les pondérations versionnées", () => {
  assert.equal(calculateAnnualAverage([12, 15, null], [1, 2, 1], 2), 14);
});

test("ne remplace pas une période non évaluée par zéro", () => {
  assert.equal(calculateAnnualAverage([14, null, null], [1, 1, 1], 2), 14);
});
