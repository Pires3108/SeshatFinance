import { readFile } from 'node:fs/promises';

import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { PrismaClient } from '../generated/prisma/client.js';
import { createPrismaClient } from '../prisma/create-prisma-client.js';
import { PrismaRecoveryRequestAttemptRepository } from './prisma-recovery-request-attempt-repository.js';

describe('PrismaRecoveryRequestAttemptRepository', () => {
  let prisma: PrismaClient | undefined;
  let repository: PrismaRecoveryRequestAttemptRepository | undefined;
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
          '../../prisma/migrations/20261010120000_recovery_request_attempts/migration.sql',
          import.meta.url,
        ),
        'utf8',
      ),
    );
    await client.end();
    const clientPrisma = createPrismaClient(container.getConnectionUri());
    prisma = clientPrisma;
    repository = new PrismaRecoveryRequestAttemptRepository(
      () => clientPrisma,
      () => 'a'.repeat(43),
    );
  }, 60_000);

  afterAll(async (): Promise<void> => {
    await prisma?.$disconnect();
    await stop?.();
  });

  it('throttles by normalized identity after five requests without storing email', async () => {
    if (!repository || !prisma) throw new Error('Persistence unavailable.');
    const now = new Date('2026-10-10T12:00:00Z');
    for (let attempt = 0; attempt < 5; attempt += 1)
      expect(
        await repository.allowAndRecord('Synthetic@example.test', now),
      ).toBe(true);
    expect(await repository.allowAndRecord('synthetic@example.test', now)).toBe(
      false,
    );
    expect(await repository.allowAndRecord('other@example.test', now)).toBe(
      true,
    );
    expect(
      await repository.allowAndRecord(
        'synthetic@example.test',
        new Date(now.getTime() + 5 * 60_000),
      ),
    ).toBe(true);
    expect(
      await repository.allowAndRecord(
        'synthetic@example.test',
        new Date(now.getTime() + 14 * 60_000),
      ),
    ).toBe(false);
    expect(
      await repository.allowAndRecord(
        'synthetic@example.test',
        new Date(now.getTime() + 15 * 60_000),
      ),
    ).toBe(true);
    const rows = await prisma.$queryRaw<
      readonly { email_hash: Buffer }[]
    >`SELECT email_hash FROM auth_recovery_request_attempts`;
    expect(rows).toHaveLength(2);
    expect(
      rows.some((row) =>
        row.email_hash.toString('utf8').includes('synthetic@example.test'),
      ),
    ).toBe(false);
  });

  it('serializes concurrent requests for the same unknown identity', async () => {
    if (!repository) throw new Error('Persistence unavailable.');
    const attempts = repository;
    const now = new Date('2026-10-10T12:00:00Z');
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        attempts.allowAndRecord('unknown@example.test', now),
      ),
    );
    expect(results.filter(Boolean)).toHaveLength(5);
  });
});
