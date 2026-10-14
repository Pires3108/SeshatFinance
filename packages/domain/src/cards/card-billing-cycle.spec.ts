import { describe, expect, it } from 'vitest';

import {
  CardBillingCycle,
  InvalidCardBillingCycleError,
} from './card-billing-cycle.js';

const properties = {
  startsAt: new Date('2026-02-28T03:00:00Z'),
  closesAt: new Date('2026-03-31T03:00:00Z'),
  timeZone: 'America/Sao_Paulo',
  closingBoundary: 'next-cycle' as const,
};

describe('CardBillingCycle', () => {
  it.each(['next-cycle', 'closing-cycle'] as const)(
    'assigns a shared boundary to exactly one cycle with %s',
    (closingBoundary) => {
      const first = CardBillingCycle.create({ ...properties, closingBoundary });
      const second = CardBillingCycle.create({
        ...properties,
        closingBoundary,
        startsAt: properties.closesAt,
        closesAt: new Date('2026-04-30T03:00:00Z'),
      });
      const at = properties.closesAt;
      expect(
        [first, second].filter((cycle) => cycle.contains(at)),
      ).toHaveLength(1);
      expect(first.contains(at)).toBe(closingBoundary === 'closing-cycle');
    },
  );

  it('preserves the civil-calendar instants and does not mutate them', () => {
    const cycle = CardBillingCycle.create(properties);
    cycle.toSnapshot().closesAt.setTime(0);
    expect(cycle.contains(new Date('2026-03-31T02:59:59.999Z'))).toBe(true);
    expect(cycle.contains(new Date('2026-03-31T03:00:00Z'))).toBe(false);
  });

  it.each([
    { ...properties, timeZone: 'invalid/timezone' },
    { ...properties, startsAt: properties.closesAt },
    { ...properties, closesAt: new Date('invalid') },
  ])('rejects invalid calendar input', (input) => {
    expect(() => CardBillingCycle.create(input)).toThrow(
      InvalidCardBillingCycleError,
    );
  });
});
