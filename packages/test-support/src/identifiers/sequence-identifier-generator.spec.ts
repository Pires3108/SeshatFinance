import { describe, expect, it } from 'vitest';

import { SequenceIdentifierGenerator } from './sequence-identifier-generator.js';

describe('SequenceIdentifierGenerator', () => {
  it('returns identifiers in their configured order', (): void => {
    const generator = new SequenceIdentifierGenerator(['first', 'second']);

    expect(generator.generate()).toBe('first');
    expect(generator.generate()).toBe('second');
    expect(() => generator.generate()).toThrow('sequence is exhausted');
  });
});
