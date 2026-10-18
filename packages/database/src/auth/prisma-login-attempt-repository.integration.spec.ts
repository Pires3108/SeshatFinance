import { readFile } from 'node:fs/promises';

import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { PrismaClient } from '../generated/prisma/client.js';
import { createPrismaClient } from '../prisma/create-prisma-client.js';
import { PrismaLoginAttemptRepository } from './prisma-login-attempt-repository.js';

describe('PrismaLoginAttemptRepository', () => {
  let prisma: PrismaClient | undefined;
  let repository: PrismaLoginAttemptRepository | undefined;
  let stop: (() => Promise<void>) | undefined;

  beforeAll(async (): Promise<void> => {
    const container = await new PostgreSqlContainer('postgres:17-alpine')
      .withDatabase('seshat_test')
      .withUsername('seshat_test')
      .withPassword('synthetic-test-password')
      .start();
    stop = async (): Promise<void> => container.stop().then(() => undefined);
    const client = new Client({
      connectionString: container.getConnectionUri(),
    });
    await client.connect();
    await client.query(
      await readFile(
        new URL(
          '../../prisma/migrations/20261009120000_login_attempts/migration.sql',
          import.meta.url,
        ),
        'utf8',
      ),
    );
    await client.query(
      await readFile(
        new URL(
          '../../prisma/migrations/20261013130000_login_leases/migration.sql',
          import.meta.url,
        ),
        'utf8',
      ),
    );
    await client.end();
    const clientPrisma = createPrismaClient(container.getConnectionUri());
    prisma = clientPrisma;
    repository = new PrismaLoginAttemptRepository(
      () => clientPrisma,
      () => 'a'.repeat(43),
    );
  }, 60_000);

  afterAll(async (): Promise<void> => {
    await prisma?.$disconnect();
    await stop?.();
  });

  it('locks on fifth failure, applies longer repeat lockouts, and stores no email', async () => {
    if (!repository || !prisma) throw new Error('Persistence unavailable.');
    const email = 'synthetic@example.test';
    const now = new Date('2026-10-09T12:00:00Z');
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await repository.runExclusive(email, (state) => state.recordFailure(now));
      expect(
        await repository.runExclusive(email, (state) => state.isLocked(now)),
      ).toBe(false);
    }
    await repository.runExclusive(email, (state) => state.recordFailure(now));
    expect(
      await repository.runExclusive(email, (state) => state.isLocked(now)),
    ).toBe(true);
    expect(
      await repository.runExclusive(email, (state) =>
        state.isLocked(new Date(now.getTime() + 5 * 60_000)),
      ),
    ).toBe(false);
    await repository.runExclusive(email, (state) =>
      state.recordFailure(new Date(now.getTime() + 5 * 60_000)),
    );
    expect(
      await repository.runExclusive(email, (state) =>
        state.isLocked(new Date(now.getTime() + 14 * 60_000)),
      ),
    ).toBe(true);
    expect(
      await repository.runExclusive(email, (state) =>
        state.isLocked(new Date(now.getTime() + 15 * 60_000)),
      ),
    ).toBe(false);
    const rows = await prisma.$queryRaw<
      readonly { email_hash: Buffer }[]
    >`SELECT email_hash FROM auth_login_attempts`;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.email_hash.toString('utf8')).not.toContain(email);
    await repository.runExclusive(email, (state) => state.clear());
    expect(
      await repository.runExclusive(email, (state) => state.isLocked(now)),
    ).toBe(false);
  });

  it('counts concurrent failures atomically for an unknown identity', async () => {
    const current = repository;
    if (!current) throw new Error('Persistence unavailable.');
    const email = 'unknown@example.test';
    const now = new Date('2026-10-09T12:00:00Z');
    await Promise.all(
      Array.from({ length: 5 }, () =>
        current.runExclusive(email, (state) => state.recordFailure(now)),
      ),
    );
    expect(
      await current.runExclusive(email, (state) => state.isLocked(now)),
    ).toBe(true);
  });

  it('serializes a fifth failure before a concurrent login decision', async () => {
    const current = repository;
    if (!current) throw new Error('Persistence unavailable.');
    const email = 'concurrent@example.test';
    const now = new Date('2026-10-09T12:00:00Z');
    for (let attempt = 0; attempt < 4; attempt += 1)
      await current.runExclusive(email, (state) => state.recordFailure(now));

    let releaseFailure: (() => void) | undefined;
    const holdFailure = new Promise<void>((resolve) => {
      releaseFailure = resolve;
    });
    let announceLock: (() => void) | undefined;
    const lockAcquired = new Promise<void>((resolve) => {
      announceLock = resolve;
    });
    const fifth = current.runExclusive(email, async (state) => {
      announceLock?.();
      await holdFailure;
      await state.recordFailure(now);
    });
    await lockAcquired;
    const concurrentDecision = current.runExclusive(email, (state) =>
      state.isLocked(now),
    );
    releaseFailure?.();
    await fifth;
    await expect(concurrentDecision).resolves.toBe(true);
  });

  it('does not hold a PostgreSQL transaction while the protected action waits', async () => {
    const current = repository;
    const database = prisma;
    if (!current || !database) throw new Error('Persistence unavailable.');
    await current.runExclusive('held@example.test', async () => {
      const rows = await database.$queryRaw<readonly { active: bigint }[]>`
        SELECT COUNT(*) AS active FROM pg_stat_activity
        WHERE datname = current_database() AND state = 'idle in transaction'`;
      expect(rows[0]?.active).toBe(0n);
    });
  });

  it('uses database time for lease expiry and prunes abandoned expired leases', async () => {
    const current = repository;
    const database = prisma;
    if (!current || !database) throw new Error('Persistence unavailable.');
    await database.$executeRaw`
      INSERT INTO auth_login_leases (email_hash, holder, expires_at)
      VALUES (${Buffer.alloc(32, 1)}, ${'00000000-0000-4000-8000-000000000001'}::uuid,
        NOW() - INTERVAL '1 minute')`;
    await current.runExclusive('live@example.test', async () => {
      const rows = await database.$queryRaw<readonly { valid: boolean }[]>`
        SELECT expires_at BETWEEN NOW() + INTERVAL '9 minutes'
          AND NOW() + INTERVAL '11 minutes' AS valid
        FROM auth_login_leases WHERE expires_at > NOW()`;
      expect(rows[0]?.valid).toBe(true);
      expect(await current.pruneExpired()).toBe(1);
      const remaining = await database.$queryRaw<readonly { count: bigint }[]>`
        SELECT COUNT(*) AS count FROM auth_login_leases`;
      expect(remaining[0]?.count).toBe(1n);
    });
  });
});
