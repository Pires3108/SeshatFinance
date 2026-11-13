import type { CivilDate } from '../calendar/civil-date.js';

/**
 * Server-derived invoice state (US-042). "overdue" only after the effective
 * due date has passed with a remaining obligation; the due date itself is
 * not overdue. Paying in full removes the debt state immediately.
 */
export type InvoiceDueState =
  'no-purchases' | 'paid' | 'on-time' | 'attention' | 'overdue';

/** Default lead time for the attention state, decided on 13/11/2026. */
export const DEFAULT_INVOICE_ATTENTION_DAYS = 5;
export const MAX_INVOICE_ATTENTION_DAYS = 30;

export class InvalidInvoiceAttentionDaysError extends Error {
  public constructor() {
    super('Attention days must be an integer between 0 and 30.');
    this.name = 'InvalidInvoiceAttentionDaysError';
  }
}

export function assertInvoiceAttentionDays(value: number): void {
  if (
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > MAX_INVOICE_ATTENTION_DAYS
  ) {
    throw new InvalidInvoiceAttentionDaysError();
  }
}

export type InvoiceDueStateInput = Readonly<{
  /** Effective due date (after weekends and holidays). */
  dueOn: CivilDate;
  /** Civil date of "now" in the holder's time zone. */
  today: CivilDate;
  purchasesMinorUnits: bigint;
  remainingMinorUnits: bigint;
  attentionDays: number;
}>;

export type InvoiceDueStateView = Readonly<{
  state: InvoiceDueState;
  /** Calendar days until the due date; negative once overdue. */
  daysUntilDue: number;
}>;

const DAY_MS = 86_400_000;

export function deriveInvoiceDueState(
  input: InvoiceDueStateInput,
): InvoiceDueStateView {
  assertInvoiceAttentionDays(input.attentionDays);
  const daysUntilDue = Math.round(input.dueOn.compare(input.today) / DAY_MS);
  if (input.purchasesMinorUnits <= 0n) {
    return { daysUntilDue, state: 'no-purchases' };
  }
  if (input.remainingMinorUnits <= 0n) return { daysUntilDue, state: 'paid' };
  if (daysUntilDue < 0) return { daysUntilDue, state: 'overdue' };
  if (daysUntilDue <= input.attentionDays) {
    return { daysUntilDue, state: 'attention' };
  }
  return { daysUntilDue, state: 'on-time' };
}
