import { readFile } from 'node:fs/promises';

import { OpaqueSessionService } from '@seshat/application';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { PrismaClient } from '../generated/prisma/client.js';
import { createPrismaClient } from '../prisma/create-prisma-client.js';
import { PrismaOpaqueSessionRepository } from './prisma-opaque-session-repository.js';

describe('PrismaOpaqueSessionRepository', () => {
  let prisma: PrismaClient | undefined;
  let secondPrisma: PrismaClient | undefined;
  let repository: PrismaOpaqueSessionRepository | undefined;
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
          '../../prisma/migrations/20260929120000_create_user_sessions/migration.sql',
          import.meta.url,
        ),
        'utf8',
      ),
    );
    await client.end();
    prisma = createPrismaClient(container.getConnectionUri());
    secondPrisma = createPrismaClient(container.getConnectionUri());
    repository = new PrismaOpaqueSessionRepository(prisma);
  }, 60_000);

  afterAll(async (): Promise<void> => {
    await prisma?.$disconnect();
    await secondPrisma?.$disconnect();
    await stop?.();
  });

  it('stores a hash, validates expiration atomically, and rejects use after revocation', async () => {
    if (repository === undefined || prisma === undefined)
      throw new Error('Persistence unavailable.');
    const at = new Date('2026-09-29T12:00:00.000Z');
    await repository.create({
      id: '11111111-1111-4111-8111-111111111111',
      userId: '22222222-2222-4222-8222-222222222222',
      tokenHash: 'a'.repeat(64),
      createdAt: at,
      lastSeenAt: at,
      revokedAt: null,
    });
    expect(await repository.findByTokenHash('a'.repeat(64))).toMatchObject({
      tokenHash: 'a'.repeat(64),
    });
    expect(
      await repository.touchIfActive(
        '11111111-1111-4111-8111-111111111111',
        new Date(at.getTime() + 29 * 60_000),
      ),
    ).toBe(true);
    await repository.revoke(
      '11111111-1111-4111-8111-111111111111',
      new Date(at.getTime() + 29 * 60_000),
    );
    expect(
      await repository.touchIfActive(
        '11111111-1111-4111-8111-111111111111',
        new Date(at.getTime() + 29 * 60_000),
      ),
    ).toBe(false);
    expect(await prisma.userSession.count()).toBe(1);
  });

  it('shares revocation between instances before another protected action', async () => {
    if (repository === undefined || secondPrisma === undefined)
      throw new Error('Persistence unavailable.');
    const at = new Date('2026-09-29T13:00:00.000Z');
    const clock = { now: (): Date => at };
    const tokens = {
      generate: (): string => 'synthetic-token',
      hash: (): string => 'b'.repeat(64),
    };
    const identifiers = {
      generate: (): string => '33333333-3333-4333-8333-333333333333',
    };
    const first = new OpaqueSessionService(
      repository,
      tokens,
      clock,
      identifiers,
    );
    const second = new OpaqueSessionService(
      new PrismaOpaqueSessionRepository(secondPrisma),
      tokens,
      clock,
      identifiers,
    );

    const issued = await first.issue('22222222-2222-4222-8222-222222222222');
    expect(await second.resolve(issued.token)).toBe(
      '22222222-2222-4222-8222-222222222222',
    );
    await first.revoke(issued.token);
    await expect(second.resolve(issued.token)).rejects.toThrow(
      'Session is invalid or expired.',
    );
  });

  it('enforces inactivity and absolute boundaries with an injected clock', async () => {
    if (repository === undefined || secondPrisma === undefined)
      throw new Error('Persistence unavailable.');
    const createdAt = new Date('2026-09-29T14:00:00.000Z');
    let now = createdAt;
    let currentHash = 'c';
    const clock = { now: (): Date => now };
    const tokens = {
      generate: (): string => 'another-synthetic-token',
      hash: (): string => currentHash.repeat(64),
    };
    const first = new OpaqueSessionService(repository, tokens, clock, {
      generate: (): string => '44444444-4444-4444-8444-444444444444',
    });
    const second = new OpaqueSessionService(
      new PrismaOpaqueSessionRepository(secondPrisma),
      tokens,
      clock,
      { generate: (): string => '55555555-5555-4555-8555-555555555555' },
    );
    const issued = await first.issue('22222222-2222-4222-8222-222222222222');

    now = new Date(createdAt.getTime() + 30 * 60_000 - 1);
    expect(await second.resolve(issued.token)).toBe(
      '22222222-2222-4222-8222-222222222222',
    );
    now = new Date(createdAt.getTime() + 60 * 60_000 - 1);
    await expect(first.resolve(issued.token)).rejects.toThrow(
      'Session is invalid or expired.',
    );

    now = new Date(createdAt.getTime() + 2 * 60 * 60_000);
    currentHash = 'd';
    const longSession = await second.issue(
      '22222222-2222-4222-8222-222222222222',
    );
    for (let minute = 29; minute < 12 * 60; minute += 29) {
      now = new Date(createdAt.getTime() + 2 * 60 * 60_000 + minute * 60_000);
      expect(await first.resolve(longSession.token)).toBe(
        '22222222-2222-4222-8222-222222222222',
      );
    }
    now = new Date(createdAt.getTime() + 14 * 60 * 60_000);
    await expect(first.resolve(longSession.token)).rejects.toThrow(
      'Session is invalid or expired.',
    );
  });
});
