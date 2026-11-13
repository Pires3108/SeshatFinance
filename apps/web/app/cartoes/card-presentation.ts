import type { paths } from '@seshat/contracts';

import { formatBalance } from '../accounts/account-presentation';

export type Card =
  paths['/api/v1/credit-cards']['get']['responses'][200]['content']['application/json'][number];
export type CardCycle =
  paths['/api/v1/credit-cards/{cardId}/cycle']['get']['responses'][200]['content']['application/json'];
export type ClosingBoundary = Card['closingBoundary'];

export const boundaryLabels: Readonly<Record<ClosingBoundary, string>> = {
  'closing-cycle': 'Compras no dia do fechamento entram na fatura que fecha',
  'next-cycle': 'Compras no dia do fechamento entram na próxima fatura',
};

/** "2026-11-09" → "09/11/2026" without passing through a Date. */
export function formatCivilDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (match === null) return value;
  const [, year = '', month = '', day = ''] = match;
  return `${day}/${month}/${year}`;
}

export function formatLimit(card: Card): string {
  return formatBalance({
    amount: card.limit,
    currencyCode: card.currencyCode,
    currencyMinorUnitScale: card.currencyMinorUnitScale,
  });
}

export function cycleSummary(cycle: CardCycle): string {
  return `Fatura atual: compras de ${formatCivilDate(cycle.firstPurchaseDate)} a ${formatCivilDate(cycle.lastPurchaseDate)}, fecha em ${formatCivilDate(cycle.closesOn)} e vence em ${formatCivilDate(cycle.dueOn)}.`;
}

/** Explains a due date moved by a weekend or holiday. */
export function dueShiftNote(cycle: CardCycle): string | null {
  return cycle.dueOn === cycle.scheduledDueOn
    ? null
    : `O vencimento configurado (${formatCivilDate(cycle.scheduledDueOn)}) cai em fim de semana ou feriado e passa para o próximo dia útil.`;
}

export function isCardCycle(value: unknown): value is CardCycle {
  if (typeof value !== 'object' || value === null) return false;
  const item = value as Record<string, unknown>;
  return [
    'cardId',
    'closesOn',
    'dueOn',
    'firstPurchaseDate',
    'lastPurchaseDate',
    'scheduledDueOn',
  ].every((key) => typeof item[key] === 'string');
}

export function isCardList(value: unknown): value is readonly Card[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item: unknown) =>
        typeof item === 'object' &&
        item !== null &&
        typeof (item as Record<string, unknown>).id === 'string' &&
        typeof (item as Record<string, unknown>).limit === 'string' &&
        typeof (item as Record<string, unknown>).version === 'number',
    )
  );
}
