export type LedgerAllocation = {
  amount: number;
  reversed: boolean;
};

export function calculateChargeTotals(
  amount: number,
  discounts: number[],
  allocations: LedgerAllocation[],
) {
  const discountTotal = discounts.reduce((total, value) => total + value, 0);
  const paidTotal = allocations.reduce((total, allocation) =>
    total + (allocation.reversed ? 0 : allocation.amount), 0);
  return {
    amount,
    discountTotal,
    paidTotal,
    balance: amount - discountTotal - paidTotal,
  };
}

export function expectedCashForDay(receipts: number[], refunds: number[]) {
  return receipts.reduce((total, value) => total + value, 0) -
    refunds.reduce((total, value) => total + value, 0);
}

export function canAuthorizeSeparately(receivedBy: string, authorizedBy: string) {
  return receivedBy !== authorizedBy;
}

export function formatReceiptNumber(sequence: number) {
  return `REC-${String(sequence).padStart(8, "0")}`;
}
