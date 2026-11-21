import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateChargeTotals,
  canAuthorizeSeparately,
  expectedCashForDay,
  formatReceiptNumber,
} from "../src/finance-rules";

test("le solde est recalculé depuis les frais, remises et paiements non annulés", () => {
  assert.deepEqual(calculateChargeTotals(50000, [5000], [
    { amount: 15000, reversed: false },
    { amount: 10000, reversed: true },
  ]), { amount: 50000, discountTotal: 5000, paidTotal: 15000, balance: 30000 });
});

test("la clôture de caisse tient compte des remboursements en espèces", () => {
  assert.equal(expectedCashForDay([10000, 2500], [3000]), 9500);
});

test("le reçu est séquentiel et le même agent ne peut autoriser sa propre remise", () => {
  assert.equal(formatReceiptNumber(1), "REC-00000001");
  assert.equal(formatReceiptNumber(42), "REC-00000042");
  assert.equal(canAuthorizeSeparately("cashier-1", "manager-1"), true);
  assert.equal(canAuthorizeSeparately("cashier-1", "cashier-1"), false);
});
