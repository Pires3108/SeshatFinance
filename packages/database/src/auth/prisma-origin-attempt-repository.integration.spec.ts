import { readFile } from 'node:fs/promises';

import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  AuthenticateUserUseCase,
  IdentityCredentialsRejectedError,
} from '@seshat/application';

import type { PrismaClient } from '../generated/prisma/client.js';
import { createPrismaClient } from '../prisma/create-prisma-client.js';
import { PrismaOriginAttemptRepository } from './prisma-origin-attempt-repository.js';

describe('PrismaOriginAttemptRepository', () => {
  let prisma: PrismaClient | undefined;
  let otherPrisma: PrismaClient | undefined;
  let first: PrismaOriginAttemptRepository | undefined;
  let second: PrismaOriginAttemptRepository | undefined;
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
          '../../prisma/migrations/20261013120000_auth_origin_attempts/migration.sql',
          import.meta.url,
        ),
        'utf8',
      ),
    );
    await client.end();
    const primaryClient = createPrismaClient(container.getConnectionUri());
    const secondaryClient = createPrismaClient(container.getConnectionUri());
    prisma = primaryClient;
    otherPrisma = secondaryClient;
    const key = (): string => 'a'.repeat(43);
    first = new PrismaOriginAttemptRepository(() => primaryClient, key);
    second = new PrismaOriginAttemptRepository(() => secondaryClient, key);
  }, 60_000);

  afterAll(async (): Promise<void> => {
    await prisma?.$disconnect();
    await otherPrisma?.$disconnect();
    await stop?.();
  });

  it('shares failed login limits across instances and does not store an address', async () => {
    if (!first || !second || !prisma)
      throw new Error('Persistence unavailable.');
    const now = new Date('2026-10-13T12:00:00Z');
    for (let index = 0; index < 5; index += 1) {
      const repository = index % 2 ? first : second;
      const reservation = await repository.reserve('192.0.2.1', now);
      await repository.finish(
        '192.0.2.1',
        requireReservation(reservation),
        true,
        now,
      );
    }
    expect(await first.reserve('192.0.2.1', now)).toBeNull();
    expect(await second.reserve('192.0.2.2', now)).not.toBeNull();
    const afterFiveMinutes = new Date(now.getTime() + 5 * 60_000);
    const reservation = await second.reserve('192.0.2.1', afterFiveMinutes);
    await first.finish(
      '192.0.2.1',
      requireReservation(reservation),
      true,
      afterFiveMinutes,
    );
    expect(
      await second.reserve('192.0.2.1', new Date(now.getTime() + 14 * 60_000)),
    ).toBeNull();
    expect(
      await second.reserve('192.0.2.1', new Date(now.getTime() + 15 * 60_000)),
    ).not.toBeNull();
    const rows = await prisma.$queryRaw<
      readonly { origin_hash: Buffer }[]
    >`SELECT origin_hash FROM auth_origin_attempts`;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.origin_hash.toString('utf8')).not.toContain('192.0.2.1');
  });

  it('serializes concurrent failed logins for distinct emails across connections', async () => {
    if (!first || !second) throw new Error('Persistence unavailable.');
    const now = new Date('2026-10-13T13:00:00Z');
    let authenticateCalls = 0;
    const attempts = {
      runExclusive: async <T>(
        _email: string,
        action: (state: {
          isLocked(now: Date): Promise<boolean>;
          recordFailure(now: Date): Promise<void>;
          clear(): Promise<void>;
        }) => Promise<T>,
      ): Promise<T> =>
        action({
          isLocked: () => Promise.resolve(false),
          recordFailure: () => Promise.resolve(),
          clear: () => Promise.resolve(),
        }),
    };
    const requests = Array.from({ length: 10 }, (_, index) => {
      const useCase = new AuthenticateUserUseCase(
        {
          authenticate: () => {
            authenticateCalls += 1;
            return Promise.reject(new IdentityCredentialsRejectedError());
          },
        },
        attempts,
        { now: () => now },
        index % 2 ? first : second,
      );
      return useCase
        .execute({
          email: `identity-${String(index)}@example.test`,
          password: 'synthetic',
          origin: '203.0.113.1',
        })
        .catch(() => undefined);
    });
    await Promise.all(requests);
    expect(authenticateCalls).toBe(5);
  });

  it('releases a successful reservation and records a failed reservation once', async () => {
    if (!first || !second || !prisma)
      throw new Error('Persistence unavailable.');
    const now = new Date('2026-10-13T14:00:00Z');
    const origin = '203.0.113.8';
    const successful = await first.reserve(origin, now);
    await second.finish(origin, requireReservation(successful), false, now);
    const failed = await second.reserve(origin, now);
    await first.finish(origin, requireReservation(failed), true, now);
    await second.finish(origin, requireReservation(failed), true, now);
    const rows = await prisma.$queryRaw<readonly { attempts: number }[]>`
      SELECT attempts FROM auth_origin_attempts WHERE purpose = 'login'`;
    expect(rows.some((row) => row.attempts === 1)).toBe(true);
  });

  it('serializes concurrent recovery requests across instances', async () => {
    if (!first || !second) throw new Error('Persistence unavailable.');
    const now = new Date('2026-10-13T12:00:00Z');
    const firstRepository = first;
    const secondRepository = second;
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, index) =>
        (index % 2 ? firstRepository : secondRepository).allowAndRecord(
          '198.51.100.1',
          now,
        ),
      ),
    );
    expect(results.filter(Boolean)).toHaveLength(5);
  });
});

function requireReservation(reservation: string | null): string {
  if (reservation === null) throw new Error('Expected an origin reservation.');
  return reservation;
}
