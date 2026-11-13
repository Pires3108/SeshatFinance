import { describe, expect, it } from 'vitest';

import { invoiceStateLabel } from './invoice-state';

describe('invoiceStateLabel', () => {
  it.each([
    ['overdue', -1, 'Vencida há 1 dia'],
    ['overdue', -3, 'Vencida há 3 dias'],
    ['attention', 0, 'Atenção: vence hoje'],
    ['attention', 1, 'Atenção: vence amanhã'],
    ['attention', 4, 'Atenção: vence em 4 dias'],
    ['paid', -10, 'Quitada'],
    ['on-time', 20, 'Em dia'],
    ['no-purchases', 0, 'Sem compras'],
  ] as const)('%s with %i days reads "%s"', (state, days, label) => {
    expect(invoiceStateLabel(state, days)).toBe(label);
  });
});
