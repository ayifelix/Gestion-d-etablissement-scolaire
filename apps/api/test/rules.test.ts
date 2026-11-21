import test from "node:test";
import assert from "node:assert/strict";
import { assertDateRange, overlaps, buildMatricule, validateMark } from "../src/rules";

test("refuse une date de fin antérieure à la date de début", () => {
  assert.throws(
    () => assertDateRange(new Date("2026-12-01"), new Date("2026-10-01")),
    /date de fin/,
  );
});

test("détecte le chevauchement de deux affectations datées", () => {
  assert.equal(
    overlaps(
      new Date("2026-09-01"),
      new Date("2026-12-31"),
      new Date("2026-10-01"),
      null,
    ),
    true,
  );
});

test("génère un matricule unique avec un numéro fixe", () => {
  assert.equal(buildMatricule("2026-2027", 12), "EL-20262027-000012");
});

test("refuse une note supérieure au barème", () => {
  assert.throws(() => validateMark("NOTE", 21, 20), /comprise entre 0 et 20/);
});

test("une absence justifiée reste un statut sans note numérique", () => {
  assert.doesNotThrow(() => validateMark("ABSENT_JUSTIFIE", undefined, 20));
  assert.throws(() => validateMark("ABSENT_JUSTIFIE", 0, 20), /ne peut pas être enregistrée comme une note/);
});
