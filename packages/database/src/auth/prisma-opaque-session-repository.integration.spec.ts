import { readFile } from 'node:fs/promises';

import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { PrismaClient } from '../generated/prisma/client.js';
import { createPrismaClient } from '../prisma/create-prisma-client.js';
import { PrismaOpaqueSessionRepository } from './prisma-opaque-session-repository.js';

describe('PrismaOpaqueSessionRepository', () => {
  let prisma: PrismaClient | undefined;
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
    repository = new PrismaOpaqueSessionRepository(prisma);
  }, 60_000);

  afterAll(async (): Promise<void> => {
    await prisma?.$disconnect();
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
});
