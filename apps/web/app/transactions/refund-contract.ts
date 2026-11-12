import { uuid } from './transaction-contract';

export type RefundEntry = Readonly<{
  id: string;
  kind: 'refund' | 'compensation';
  accountId: string;
  amount: string;
  currencyCode: string;
  description: string | null;
  occurredAt: string;
  lifecycle: 'active' | 'archived' | 'trashed';
  reason: string | null;
}>;

export type RefundDetails = Readonly<{
  gross: string;
  refunded: string;
  net: string;
  currencyCode: string;
  currencyMinorUnitScale: number;
  presentation: 'separate-income' | 'expense-offset';
  entries: readonly RefundEntry[];
}>;

const decimal = /^-?\d+(?:\.\d+)?$/u;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isRefundEntry(value: unknown): value is RefundEntry {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === 'string' &&
    uuid.test(value.id) &&
    (value.kind === 'refund' || value.kind === 'compensation') &&
    typeof value.accountId === 'string' &&
    uuid.test(value.accountId) &&
    typeof value.amount === 'string' &&
    decimal.test(value.amount) &&
    typeof value.currencyCode === 'string' &&
    /^[A-Z]{3}$/u.test(value.currencyCode) &&
    (value.description === null || typeof value.description === 'string') &&
    typeof value.occurredAt === 'string' &&
    !Number.isNaN(Date.parse(value.occurredAt)) &&
    (value.lifecycle === 'active' ||
      value.lifecycle === 'archived' ||
      value.lifecycle === 'trashed') &&
    (value.reason === null || typeof value.reason === 'string')
  );
}

export function isRefundDetails(value: unknown): value is RefundDetails {
  if (!isRecord(value)) return false;
  return (
    typeof value.gross === 'string' &&
    decimal.test(value.gross) &&
    typeof value.refunded === 'string' &&
    decimal.test(value.refunded) &&
    typeof value.net === 'string' &&
    decimal.test(value.net) &&
    typeof value.currencyCode === 'string' &&
    /^[A-Z]{3}$/u.test(value.currencyCode) &&
    typeof value.currencyMinorUnitScale === 'number' &&
    Number.isInteger(value.currencyMinorUnitScale) &&
    (value.presentation === 'separate-income' ||
      value.presentation === 'expense-offset') &&
    Array.isArray(value.entries) &&
    value.entries.every(isRefundEntry)
  );
}

/** Formats a decimal string in pt-BR without converting it to a number. */
export function formatDecimal(amount: string, currencyCode: string): string {
  const negative = amount.startsWith('-');
  const [whole = '0', fraction = ''] = (
    negative ? amount.slice(1) : amount
  ).split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/gu, '.');
  return `${negative ? '-' : ''}${grouped}${fraction ? `,${fraction}` : ''} ${currencyCode}`;
}
