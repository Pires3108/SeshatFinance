import { describe, expect, it } from 'vitest';

import { isIanaTimeZone } from './iana-time-zone.js';

describe('isIanaTimeZone', () => {
  it.each([
    'America/Sao_Paulo',
    'America/Argentina/Buenos_Aires',
    'America/Port-au-Prince',
    'Etc/GMT+3',
    'UTC',
  ])('accepts %s', (value): void => {
    expect(isIanaTimeZone(value)).toBe(true);
  });

  it.each([
    '',
    'Invalid/Zone',
    '+03:00',
    '-0300',
    'america/sao_paulo',
    'America/sao_paulo',
    'AMERICA/SAO_PAULO',
    'us/eastern',
    ' America/Sao_Paulo',
    `America/${'A'.repeat(64)}`,
  ])('rejects %j', (value): void => {
    expect(isIanaTimeZone(value)).toBe(false);
  });
});
