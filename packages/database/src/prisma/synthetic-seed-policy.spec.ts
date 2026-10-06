import { describe, expect, it } from 'vitest';

import { assertSyntheticSeedTarget } from './synthetic-seed-policy.js';

describe('synthetic seed policy', () => {
  it('rejects production before accepting any connection target', () => {
    expect(() =>
      assertSyntheticSeedTarget(
        'postgresql://localhost/synthetic',
        'production',
      ),
    ).toThrow('prohibited in production');
    expect(() => assertSyntheticSeedTarget(undefined, 'production')).toThrow(
      'prohibited in production',
    );
  });

  it('rejects missing, remote and non-PostgreSQL targets', () => {
    expect(() =>
      assertSyntheticSeedTarget('synthetic-secret-marker', 'test'),
    ).toThrow('A valid PostgreSQL connection URL is required.');
    expect(() => assertSyntheticSeedTarget(undefined, 'test')).toThrow(
      'DATABASE_URL',
    );
    for (const target of [
      'postgresql://remote.example/synthetic',
      'https://localhost/synthetic',
    ]) {
      expect(() => assertSyntheticSeedTarget(target, 'development')).toThrow(
        'local PostgreSQL',
      );
    }
  });

  it('allows explicit loopback development and integration targets', () => {
    for (const host of ['localhost', '127.0.0.1', '[::1]']) {
      const target = `postgresql://${host}:55439/synthetic`;
      expect(assertSyntheticSeedTarget(target, 'test')).toBe(target);
    }
  });
});
