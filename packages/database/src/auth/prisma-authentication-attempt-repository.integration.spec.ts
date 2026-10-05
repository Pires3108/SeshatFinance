import { readFile } from 'node:fs/promises';

import type { AuthenticationAttempt } from '@seshat/application';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { PrismaClient } from '../generated/prisma/client.js';
import { createPrismaClient } from '../prisma/create-prisma-client.js';
import { PrismaAuthenticationAttemptRepository } from './prisma-authentication-attempt-repository.js';

const hmacKey = 'synthetic-authentication-limit-key-only-for-tests';
const rejected = (): Promise<AuthenticationAttempt> =>
  Promise.resolve({ kind: 'rejected' });

describe('PrismaAuthenticationAttemptRepository', () => {
  let firstClient: PrismaClient | undefined;
  let secondClient: PrismaClient | undefined;
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
          '../../prisma/migrations/20261003220000_create_authentication_attempt_limits/migration.sql',
          import.meta.url,
        ),
        'utf8',
      ),
    );
    await client.end();
    firstClient = createPrismaClient(container.getConnectionUri());
    secondClient = createPrismaClient(container.getConnectionUri());
  }, 60_000);

  afterAll(async (): Promise<void> => {
    await firstClient?.$disconnect();
    await secondClient?.$disconnect();
    await stop?.();
  });

  it('shares progressive lockouts across instances without storing email', async () => {
    if (firstClient === undefined || secondClient === undefined)
      throw new Error('Persistence unavailable.');
    const first = new PrismaAuthenticationAttemptRepository(
      firstClient,
      hmacKey,
    );
    const second = new PrismaAuthenticationAttemptRepository(
      secondClient,
      hmacKey,
    );
    const email = 'synthetic.user@example.test';
    let now = new Date('2026-10-03T12:00:00.000Z');

    for (const durationMinutes of [5, 10, 20, 40, 80, 80]) {
      for (let failure = 0; failure < 5; failure += 1) {
        const repository = failure % 2 === 0 ? first : second;
        expect(await repository.execute(email, now, rejected)).toEqual({
          kind: 'rejected',
        });
      }
      const authenticate = vi.fn(rejected);
      expect(await second.execute(email, now, authenticate)).toEqual({
        kind: 'blocked',
      });
      expect(authenticate).not.toHaveBeenCalled();
      now = new Date(now.getTime() + durationMinutes * 60_000 - 1);
      expect(await first.execute(email, now, authenticate)).toEqual({
        kind: 'blocked',
      });
      now = new Date(now.getTime() + 1);
    }

    const rows = await firstClient.authenticationAttemptLimit.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.identityHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(JSON.stringify(rows)).not.toContain(email);
  });

  it('serializes concurrent attempts and leaves provider outages uncounted', async () => {
    if (firstClient === undefined || secondClient === undefined)
      throw new Error('Persistence unavailable.');
    const first = new PrismaAuthenticationAttemptRepository(
      firstClient,
      hmacKey,
    );
    const second = new PrismaAuthenticationAttemptRepository(
      secondClient,
      hmacKey,
    );
    const email = 'parallel.user@example.test';
    const now = new Date('2026-10-03T13:00:00.000Z');
    const unavailable = await first.execute(email, now, () =>
      Promise.resolve({ kind: 'unavailable' }),
    );
    expect(unavailable).toEqual({ kind: 'unavailable' });

    const authenticate = vi.fn(rejected);
    const outcomes = await Promise.all(
      Array.from({ length: 6 }, (_, index) =>
        (index % 2 === 0 ? first : second).execute(email, now, authenticate),
      ),
    );
    expect(outcomes.filter(({ kind }) => kind === 'rejected')).toHaveLength(5);
    expect(outcomes.filter(({ kind }) => kind === 'blocked')).toHaveLength(1);
    expect(authenticate).toHaveBeenCalledTimes(5);
  });

  it('resets consecutive failures after a successful login', async () => {
    if (firstClient === undefined) throw new Error('Persistence unavailable.');
    const repository = new PrismaAuthenticationAttemptRepository(
      firstClient,
      hmacKey,
    );
    const email = 'reset.user@example.test';
    const now = new Date('2026-10-03T14:00:00.000Z');
    for (let failure = 0; failure < 4; failure += 1)
      await repository.execute(email, now, rejected);

    expect(
      await repository.execute(email, now, () =>
        Promise.resolve({
          kind: 'accepted',
          session: { userId: '00000000-0000-4000-8000-000000000001' },
        }),
      ),
    ).toMatchObject({ kind: 'accepted' });
    for (let failure = 0; failure < 5; failure += 1)
      expect(await repository.execute(email, now, rejected)).toEqual({
        kind: 'rejected',
      });
    expect(await repository.execute(email, now, rejected)).toEqual({
      kind: 'blocked',
    });
  });
});
