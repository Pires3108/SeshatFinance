import { describe, expect, it } from 'vitest';

import { assertSyntheticSeedTarget } from './synthetic-seed-policy.js';

describe('synthetic seed policy', () => {
  it('rejects production before accepting any connection target', () => {
    expect(() =>
      assertSyntheticSeedTarget(
        'postgresql://seshat:seshat@localhost/seshat',
        'production',
        '1',
      ),
    ).toThrow('prohibited in production');
    expect(() =>
      assertSyntheticSeedTarget(undefined, 'production', undefined),
    ).toThrow('prohibited in production');
  });

  it('requires explicit authorization even for an approved local target', () => {
    expect(() =>
      assertSyntheticSeedTarget(
        'postgresql://seshat:seshat@localhost/seshat',
        'development',
        undefined,
      ),
    ).toThrow('explicit authorization');
  });

  it('rejects missing, remote and non-PostgreSQL targets', () => {
    expect(() =>
      assertSyntheticSeedTarget('synthetic-secret-marker', 'test', '1'),
    ).toThrow('A valid PostgreSQL connection URL is required.');
    expect(() => assertSyntheticSeedTarget(undefined, 'test', '1')).toThrow(
      'DATABASE_URL',
    );
    for (const target of [
      'postgresql://synthetic:synthetic-test-password@remote.example/migration_empty',
      'https://synthetic:synthetic-test-password@localhost/migration_empty',
    ]) {
      expect(() => assertSyntheticSeedTarget(target, 'test', '1')).toThrow();
    }
  });

  it('rejects another database reached through a local tunnel', () => {
    expect(() =>
      assertSyntheticSeedTarget(
        'postgresql://production:secret@localhost/seshat',
        'development',
        '1',
      ),
    ).toThrow('approved local fixture');
    expect(() =>
      assertSyntheticSeedTarget(
        'postgresql://seshat:seshat@localhost/finance',
        'development',
        '1',
      ),
    ).toThrow('approved local fixture');
  });

  it('allows only the Compose and named integration fixtures', () => {
    for (const host of ['localhost', '127.0.0.1', '[::1]']) {
      const compose = `postgresql://seshat:seshat@${host}:55439/seshat`;
      const integration = `postgresql://synthetic:synthetic-test-password@${host}:55439/migration_empty`;
      expect(assertSyntheticSeedTarget(compose, 'development', '1')).toBe(
        compose,
      );
      expect(assertSyntheticSeedTarget(integration, 'test', '1')).toBe(
        integration,
      );
    }
  });
});
