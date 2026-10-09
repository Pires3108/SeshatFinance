import { readFile } from 'node:fs/promises';

import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createPrismaClient } from '../prisma/create-prisma-client.js';
import { PrismaUserProfileRepository } from './prisma-user-profile-repository.js';

describe('PrismaUserProfileRepository', () => {
  let stop: (() => Promise<void>) | undefined;
  let disconnect: (() => Promise<void>) | undefined;
  let repository: PrismaUserProfileRepository | undefined;

  beforeAll(async (): Promise<void> => {
    const container = await new PostgreSqlContainer('postgres:17-alpine')
      .withDatabase('seshat_test')
      .withUsername('seshat_test')
      .withPassword('synthetic-test-password')
      .start();
    stop = async (): Promise<void> => container.stop().then(() => undefined);

    const migration = await readFile(
      new URL(
        '../../prisma/migrations/20260919210000_create_user_profiles/migration.sql',
        import.meta.url,
      ),
      'utf8',
    );
    const migrationClient = new Client({
      connectionString: container.getConnectionUri(),
    });
    await migrationClient.connect();
    await migrationClient.query(migration);
    await migrationClient.query(
      await readFile(
        new URL(
          '../../prisma/migrations/20260929180000_add_refund_presentation/migration.sql',
          import.meta.url,
        ),
        'utf8',
      ),
    );
    await migrationClient.end();

    const prisma = createPrismaClient(container.getConnectionUri());
    disconnect = async (): Promise<void> => prisma.$disconnect();
    repository = new PrismaUserProfileRepository(prisma);
  }, 60_000);

  afterAll(async (): Promise<void> => {
    await disconnect?.();
    await stop?.();
  });

  it('persists, finds, and versions an authenticated user profile', async (): Promise<void> => {
    if (repository === undefined) {
      throw new Error('Repository was not initialized.');
    }
    const createdAt = new Date('2026-09-20T12:00:00.000Z');
    const initial = await repository.upsert({
      createdAt,
      displayName: 'Nicolas',
      id: '7c2c7a54-73fe-49a3-b0ea-19034bf22baf',
      locale: 'pt-BR',
      presentationCurrency: 'BRL',
      refundPresentation: 'separate-income',
      timeZone: 'America/Sao_Paulo',
      updatedAt: createdAt,
      version: 1,
    });
    const updated = await repository.upsert({
      ...initial,
      displayName: 'Nicolas Pires',
      updatedAt: new Date('2026-09-20T13:00:00.000Z'),
    });

    await expect(repository.findById(initial.id)).resolves.toEqual(updated);
    expect(updated.version).toBe(2);
    expect(updated.createdAt).toEqual(createdAt);
  });
});
