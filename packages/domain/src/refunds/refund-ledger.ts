import { Money } from '../money/money.js';

export type RefundLedgerEntry = Readonly<{
  id: string;
  amount: Money;
  lifecycle: 'active' | 'archived' | 'trashed';
  kind: 'refund' | 'compensation';
  compensatesRefundId: string | null;
}>;

export type RefundSummary = Readonly<{
  gross: Money;
  refunded: Money;
  net: Money;
}>;

export class InvalidRefundLedgerError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'InvalidRefundLedgerError';
  }
}

export function calculateRefundSummary(
  gross: Money,
  entries: readonly RefundLedgerEntry[],
): RefundSummary {
  const effectiveRefunds = new Map<string, Money>();
  const compensations = new Map<string, Money>();
  const seenIds = new Set<string>();
  const zero = Money.fromMinorUnits(0n, gross.currency);
  if (gross.compare(zero) <= 0) {
    throw new InvalidRefundLedgerError('Expense amount must be positive.');
  }

  for (const entry of entries) {
    if (seenIds.has(entry.id)) {
      throw new InvalidRefundLedgerError('Refund link is repeated.');
    }
    seenIds.add(entry.id);
    if (!entry.amount.currency.equals(gross.currency)) {
      throw new InvalidRefundLedgerError(
        'Refund currency must match the expense.',
      );
    }
    if (entry.amount.compare(zero) <= 0) {
      throw new InvalidRefundLedgerError(
        'Refund entry amount must be positive.',
      );
    }
    if (entry.kind === 'refund') {
      if (entry.compensatesRefundId !== null) {
        throw new InvalidRefundLedgerError(
          'Refund link is invalid or repeated.',
        );
      }
      effectiveRefunds.set(
        entry.id,
        entry.lifecycle === 'trashed' ? zero : entry.amount,
      );
    } else {
      if (entry.compensatesRefundId === null) {
        throw new InvalidRefundLedgerError(
          'Compensation must name its refund.',
        );
      }
      const previous = compensations.get(entry.compensatesRefundId) ?? zero;
      compensations.set(
        entry.compensatesRefundId,
        previous.add(entry.lifecycle === 'trashed' ? zero : entry.amount),
      );
    }
  }

  let refunded = zero;
  for (const [refundId, amount] of effectiveRefunds) {
    const compensation = compensations.get(refundId) ?? zero;
    if (compensation.compare(amount) > 0) {
      throw new InvalidRefundLedgerError('Compensation exceeds its refund.');
    }
    refunded = refunded.add(amount.subtract(compensation));
  }
  for (const refundId of compensations.keys()) {
    if (!effectiveRefunds.has(refundId)) {
      throw new InvalidRefundLedgerError(
        'Compensation refers to a missing refund.',
      );
    }
  }
  if (refunded.compare(gross) > 0) {
    throw new InvalidRefundLedgerError('Active refunds exceed the expense.');
  }
  return { gross, refunded, net: gross.subtract(refunded) };
}
