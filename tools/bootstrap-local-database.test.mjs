import assert from 'node:assert/strict';
import { test } from 'node:test';

import { bootstrapLocalDatabase } from './bootstrap-local-database.mjs';

test('a failed readiness check prevents migrations and seed', () => {
  /** @type {Array<{command: string, args: string[]}>} */
  const calls = [];
  assert.throws(
    () =>
      bootstrapLocalDatabase({}, (command, args) => {
        calls.push({ command, args });
        return 1;
      }),
    /bootstrap failed/u,
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, 'docker');
  assert.ok(calls[0].args.includes('--wait'));
});

test('a migration failure prevents the synthetic seed', () => {
  /** @type {Array<{command: string, args: string[]}>} */
  const calls = [];
  assert.throws(
    () =>
      bootstrapLocalDatabase(
        { POSTGRES_PORT: '55439' },
        (command, args, env) => {
          calls.push({ command, args });
          assert.ok(env.DATABASE_URL);
          assert.equal(new URL(env.DATABASE_URL).port, '55439');
          return args.includes('migrate') ? 1 : 0;
        },
      ),
    /bootstrap failed/u,
  );
  assert.equal(calls.length, 3);
  assert.ok(!calls.some(({ args }) => args.includes('db:seed')));
});

test('invalid ports fail before starting containers', () => {
  for (const port of ['0', '65536', '5432; command', '-1', '1.5']) {
    assert.throws(
      () =>
        bootstrapLocalDatabase({ POSTGRES_PORT: port }, () => {
          assert.fail('No process should start for invalid input');
        }),
      /POSTGRES_PORT/u,
    );
  }
});

test('an external database or mismatched port is rejected before bootstrap', () => {
  for (const url of [
    'postgresql://seshat:seshat@example.test:5432/seshat',
    'postgresql://seshat:seshat@localhost:55439/seshat',
  ]) {
    assert.throws(
      () =>
        bootstrapLocalDatabase({ DATABASE_URL: url }, () => {
          assert.fail('No process should target an unrelated database');
        }),
      /synthetic local Compose/u,
    );
  }
});
