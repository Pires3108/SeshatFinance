import { describe, expect, it } from 'vitest';

import { FixedClock } from './fixed-clock.js';

describe('FixedClock', () => {
  it('returns independent copies of the configured instant', (): void => {
    const clock = new FixedClock(new Date('2026-09-19T20:00:00.000Z'));
    const first = clock.now();

    first.setUTCFullYear(2000);

    expect(clock.now().toISOString()).toBe('2026-09-19T20:00:00.000Z');
  });
});
