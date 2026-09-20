import { readFile } from 'node:fs/promises';

import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { Category } from '@seshat/domain';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createPrismaClient } from '../prisma/create-prisma-client.js';
import { PrismaCategoryRepository } from './prisma-category-repository.js';

describe('PrismaCategoryRepository', () => {
  let stop: (() => Promise<void>) | undefined;
  let disconnect: (() => Promise<void>) | undefined;
  let repository: PrismaCategoryRepository | undefined;

  beforeAll(async (): Promise<void> => {
    const container = await new PostgreSqlContainer('postgres:17-alpine')
      .withDatabase('seshat_test')
      .withUsername('seshat_test')
      .withPassword('synthetic-test-password')
      .start();
    stop = async (): Promise<void> => container.stop().then(() => undefined);
    const migration = await readFile(
      new URL(
        '../../prisma/migrations/20260920180000_create_categories/migration.sql',
        import.meta.url,
      ),
      'utf8',
    );
    const migrationClient = new Client({
      connectionString: container.getConnectionUri(),
    });
    await migrationClient.connect();
    await migrationClient.query(migration);
    await migrationClient.end();
    const prisma = createPrismaClient(container.getConnectionUri());
    disconnect = async (): Promise<void> => prisma.$disconnect();
    repository = new PrismaCategoryRepository(prisma);
  }, 60_000);

  afterAll(async (): Promise<void> => {
    await disconnect?.();
    await stop?.();
  });

  it('round-trips an owned hierarchy and uses optimistic concurrency', async () => {
    if (repository === undefined) {
      throw new Error('Repository was not initialized.');
    }
    const ownerId = 'b36bfe2a-f319-49a8-aade-2a536ea3af38';
    const parent = Category.create({
      createdAt: new Date('2026-09-20T12:00:00.000Z'),
      id: '7c2c7a54-73fe-49a3-b0ea-19034bf22baf',
      name: 'Alimentação',
      ownerId,
      parentCategoryId: null,
    });
    const child = Category.create({
      createdAt: new Date('2026-09-20T12:01:00.000Z'),
      id: 'f0ee8a15-69d3-45ca-a172-5f2512ed9fd1',
      name: 'Mercado',
      ownerId,
      parentCategoryId: parent.id,
    });

    await repository.insert(parent);
    await repository.insert(child);

    await expect(repository.listForOwner(ownerId)).resolves.toHaveLength(2);
    await expect(
      repository.findByIdForOwner(
        child.id,
        'e89b6ad0-7838-4a2c-9a21-c775ea78e22a',
      ),
    ).resolves.toBeNull();
    const restored = await repository.findByIdForOwner(child.id, ownerId);
    expect(restored?.toSnapshot()).toEqual(child.toSnapshot());

    if (restored === null) throw new Error('Category was not restored.');
    restored.rename('Supermercado', new Date('2026-09-20T13:00:00.000Z'));
    await expect(repository.save(restored, 1)).resolves.toBe(true);
    await expect(repository.save(restored, 1)).resolves.toBe(false);
  });

  it('rejects a parent from another owner at the database boundary', async () => {
    if (repository === undefined) {
      throw new Error('Repository was not initialized.');
    }
    const category = Category.create({
      createdAt: new Date('2026-09-20T14:00:00.000Z'),
      id: '79a44112-9757-4230-8065-0bfd0e078355',
      name: 'Inválida',
      ownerId: 'e89b6ad0-7838-4a2c-9a21-c775ea78e22a',
      parentCategoryId: '7c2c7a54-73fe-49a3-b0ea-19034bf22baf',
    });

    await expect(repository.insert(category)).rejects.toThrow();
  });
});
