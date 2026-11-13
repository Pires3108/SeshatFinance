import { describe, expect, it } from 'vitest';

import {
  cycleSummary,
  dueShiftNote,
  formatCivilDate,
  formatLimit,
  type Card,
  type CardCycle,
} from './card-presentation';

const cycle: CardCycle = {
  cardId: 'c722103a-e28a-482c-b6e9-e3320d8a44e3',
  closesOn: '2026-10-28',
  configurationPending: false,
  dueOn: '2026-11-09',
  firstPurchaseDate: '2026-09-28',
  holidayDatasetVersion: 'v1',
  lastPurchaseDate: '2026-10-27',
  purchaseDate: '2026-10-20',
  scheduledDueOn: '2026-11-07',
  timeZone: 'America/Sao_Paulo',
};

describe('card presentation', () => {
  it('formats civil dates without time zone conversion', () => {
    expect(formatCivilDate('2026-12-31')).toBe('31/12/2026');
  });

  it('summarizes the cycle and explains a shifted due date', () => {
    expect(cycleSummary(cycle)).toBe(
      'Fatura atual: compras de 28/09/2026 a 27/10/2026, fecha em 28/10/2026 e vence em 09/11/2026.',
    );
    expect(dueShiftNote(cycle)).toContain('07/11/2026');
    expect(dueShiftNote({ ...cycle, scheduledDueOn: '2026-11-09' })).toBeNull();
  });

  it('formats the organizational limit from its decimal string', () => {
    const card = {
      currencyCode: 'BRL',
      currencyMinorUnitScale: 2,
      limit: '3500.5',
    } as Card;
    expect(formatLimit(card)).toBe('3.500,50 BRL');
  });
});
