import type { paths } from '@seshat/contracts';

import { formatBalance } from '../accounts/account-presentation';

export type LoanView =
  paths['/api/v1/loans/{loanId}']['get']['responses'][200]['content']['application/json'];
export type LoanInstallmentView = LoanView['installments'][number];
export type LoanEventView = LoanView['events'][number];

export const situationLabels: Record<LoanInstallmentView['situation'], string> =
  {
    open: 'A vencer',
    overdue: 'Em atraso',
    paid: 'Paga',
    partial: 'Paga em parte',
    prepaid: 'Quitada antecipadamente',
    renegotiated: 'Renegociada',
  };

export const statusLabels: Record<LoanView['status'], string> = {
  active: 'Em aberto',
  renegotiated: 'Renegociado',
  settled: 'Quitado',
};

export const eventLabels: Record<LoanEventView['kind'], string> = {
  payment: 'Pagamento declarado',
  prepayment: 'Quitação antecipada',
  renegotiation: 'Renegociação',
  reversal: 'Reversão',
};

export function directionLabel(loan: LoanView): string {
  return loan.direction === 'receivable' ? 'A receber' : 'A pagar';
}

export function formatLoanAmount(loan: LoanView, amount: string): string {
  return formatBalance({
    amount,
    currencyCode: loan.currencyCode,
    currencyMinorUnitScale: loan.currencyMinorUnitScale,
  });
}

export function isLoan(value: unknown): value is LoanView {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Record<string, unknown>).pending === 'string' &&
    Array.isArray((value as Record<string, unknown>).installments)
  );
}

export function isLoanList(value: unknown): value is LoanView[] {
  return Array.isArray(value) && value.every(isLoan);
}

/** Decimal typed by the holder (comma or dot) as an API decimal string. */
export function decimalInput(value: string): string | null {
  const trimmed = value.trim();
  return /^\d+(?:[.,]\d{1,18})?$/u.test(trimmed)
    ? trimmed.replace(',', '.')
    : null;
}

export function localToday(): string {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 10);
}
