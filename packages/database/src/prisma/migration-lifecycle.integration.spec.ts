import { execFile } from 'node:child_process';
import { cp, mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';
import { expect, it } from 'vitest';

const databaseRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const execute = promisify(execFile);

async function removeOwnedFixture(fixture: string): Promise<void> {
  if (
    dirname(fixture) !== databaseRoot ||
    !fixture.startsWith(join(databaseRoot, '.migration-fixture-'))
  ) {
    throw new Error(
      'Migration fixture cleanup path is outside its owned directory.',
    );
  }
  await rm(fixture, { recursive: true, force: true });
}

async function command(
  args: readonly string[],
  databaseUrl: string,
): Promise<void> {
  await execute(process.execPath, [...args], {
    cwd: databaseRoot,
    env: { ...process.env, DATABASE_URL: databaseUrl, NODE_ENV: 'test' },
    timeout: 120_000,
    maxBuffer: 512_000,
  });
}

async function migrate(
  databaseUrl: string,
  configuration: string,
): Promise<void> {
  await command(
    [
      join(databaseRoot, 'node_modules/prisma/build/index.js'),
      'migrate',
      'deploy',
      '--config',
      configuration,
    ],
    databaseUrl,
  );
}

async function seed(databaseUrl: string): Promise<void> {
  await command(
    [
      join(databaseRoot, 'node_modules/tsx/dist/cli.mjs'),
      join(databaseRoot, 'prisma/seed.ts'),
    ],
    databaseUrl,
  );
}

it('deploys every migration, preserves representative upgrade data and repeats synthetic seed safely', async () => {
  const container = await new PostgreSqlContainer('postgres:17-alpine')
    .withStartupTimeout(180_000)
    .withDatabase('migration_empty')
    .withUsername('synthetic')
    .withPassword('synthetic-test-password')
    .start();
  const fixture = await mkdtemp(join(databaseRoot, '.migration-fixture-'));
  const empty = new Client({ connectionString: container.getConnectionUri() });
  let upgrade: Client | undefined;
  try {
    await empty.connect();
    await migrate(
      container.getConnectionUri(),
      join(databaseRoot, 'prisma7.config.ts'),
    );
    const migrations = (
      await readdir(join(databaseRoot, 'prisma/migrations'), {
        withFileTypes: true,
      })
    )
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    const applied = await empty.query<{ migration_name: string }>(
      'SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY migration_name',
    );
    expect(applied.rows.map((row) => row.migration_name)).toEqual(migrations);
    await seed(container.getConnectionUri());
    await seed(container.getConnectionUri());
    const profiles = await empty.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM user_profiles',
    );
    expect(profiles.rows[0]?.count).toBe('1');
    for (const table of [
      'accounts',
      'transactions',
      'transfers',
      'credit_cards',
    ]) {
      const count = await empty.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM ${table}`,
      );
      expect(count.rows[0]?.count).toBe('0');
    }

    await empty.query('CREATE DATABASE migration_upgrade');
    const upgradeUrl = new URL(container.getConnectionUri());
    upgradeUrl.pathname = '/migration_upgrade';
    upgrade = new Client({ connectionString: upgradeUrl.toString() });
    await upgrade.connect();
    await mkdir(join(fixture, 'prisma/migrations'), { recursive: true });
    await cp(
      join(databaseRoot, 'prisma7.config.ts'),
      join(fixture, 'prisma7.config.ts'),
    );
    await cp(
      join(databaseRoot, 'prisma/schema.prisma'),
      join(fixture, 'prisma/schema.prisma'),
    );
    await cp(
      join(databaseRoot, 'prisma/migrations/migration_lock.toml'),
      join(fixture, 'prisma/migrations/migration_lock.toml'),
    );
    for (const migration of migrations.slice(0, 3)) {
      await cp(
        join(databaseRoot, 'prisma/migrations', migration),
        join(fixture, 'prisma/migrations', migration),
        { recursive: true },
      );
    }
    await migrate(upgradeUrl.toString(), join(fixture, 'prisma7.config.ts'));
    const owner = '11111111-1111-4111-8111-111111111111';
    const account = '22222222-2222-4222-8222-222222222222';
    const transaction = '33333333-3333-4333-8333-333333333333';
    const preciseAmount = '900719925474099312345';
    await upgrade.query(
      'INSERT INTO accounts (id,owner_id,name,type_key,initial_balance_minor_units,currency_code,currency_minor_unit_scale,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
      [
        account,
        owner,
        'Synthetic upgrade account',
        'checking-account',
        preciseAmount,
        'BRL',
        2,
        '2026-10-06T12:00:00Z',
      ],
    );
    await upgrade.query(
      'INSERT INTO transactions (id,owner_id,account_id,kind,amount_minor_units,currency_code,currency_minor_unit_scale,occurred_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8)',
      [
        transaction,
        owner,
        account,
        'income',
        preciseAmount,
        'BRL',
        2,
        '2026-10-06T12:00:00Z',
      ],
    );
    await migrate(
      upgradeUrl.toString(),
      join(databaseRoot, 'prisma7.config.ts'),
    );
    await seed(upgradeUrl.toString());
    await seed(upgradeUrl.toString());
    const preserved = await upgrade.query<{
      amount: string;
      currency: string;
      owner_id: string;
      observations: string | null;
    }>(
      'SELECT amount_minor_units::text AS amount,currency_code AS currency,owner_id,observations FROM transactions WHERE id=$1',
      [transaction],
    );
    expect(preserved.rows[0]).toEqual({
      amount: preciseAmount,
      currency: 'BRL',
      owner_id: owner,
      observations: null,
    });
    const upgraded = await upgrade.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM _prisma_migrations WHERE finished_at IS NOT NULL',
    );
    expect(upgraded.rows[0]?.count).toBe(String(migrations.length));
    await expect(
      upgrade.query(
        'INSERT INTO transactions (id,owner_id,account_id,kind,amount_minor_units,currency_code,currency_minor_unit_scale,occurred_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8)',
        [
          '44444444-4444-4444-8444-444444444444',
          '55555555-5555-4555-8555-555555555555',
          account,
          'income',
          '1',
          'BRL',
          2,
          '2026-10-06T12:00:00Z',
        ],
      ),
    ).rejects.toMatchObject({ code: '23503' });
  } finally {
    await upgrade?.end();
    await empty.end();
    await container.stop();
    await removeOwnedFixture(fixture);
  }
}, 360_000);
