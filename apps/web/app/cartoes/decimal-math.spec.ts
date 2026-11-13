import { describe, expect, it } from 'vitest';

import { subtractDecimal } from './decimal-math';

describe('subtractDecimal', () => {
  it.each([
    ['137.35', '100', 2, '37.35'],
    ['0.10', '0.20', 2, '-0.10'],
    ['500.00', '89.9', 2, '410.10'],
    ['10', '3', 0, '7'],
  ])('%s - %s = expected', (a, b, scale, expected) => {
    expect(subtractDecimal(a, b, scale)).toBe(expected);
  });
});
