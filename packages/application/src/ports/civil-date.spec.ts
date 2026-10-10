import { describe, expect, it } from 'vitest';

import { readCivilDate } from './civil-date.js';
import type { Clock } from './clock.js';

const clockAt = (instant: string): Clock => ({
  now: (): Date => new Date(instant),
});

describe('readCivilDate', () => {
  it('keeps classification against a due date deterministic with a fixed clock', () => {
    const clock = clockAt('2026-10-06T02:59:59.999Z');
    const dueDate = '2026-10-06';
    const first = readCivilDate(clock, 'America/Sao_Paulo');
    expect(first).toBe('2026-10-05');
    expect(first < dueDate).toBe(true);
    expect(readCivilDate(clock, 'America/Sao_Paulo') < dueDate).toBe(true);
    expect(readCivilDate(clock, 'UTC')).toBe('2026-10-06');
  });

  it('changes the civil day at the exact midnight boundary in its zone', () => {
    expect(
      readCivilDate(clockAt('2026-10-06T03:00:00.000Z'), 'America/Sao_Paulo'),
    ).toBe('2026-10-06');
    expect(
      readCivilDate(clockAt('2026-10-05T15:00:00.000Z'), 'Asia/Tokyo'),
    ).toBe('2026-10-06');
  });

  it('rejects invalid clocks, unknown zones and numeric offsets', () => {
    expect(() => readCivilDate(clockAt('invalid'), 'UTC')).toThrow(RangeError);
    for (const zone of ['', 'Invalid/Zone', '+03:00']) {
      expect(() =>
        readCivilDate(clockAt('2026-10-06T00:00:00Z'), zone),
      ).toThrow(RangeError);
    }
  });
});
