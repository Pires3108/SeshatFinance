import { readFile } from 'node:fs/promises';

import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { CostCenter } from '@seshat/domain';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createPrismaClient } from '../prisma/create-prisma-client.js';
import { PrismaCostCenterRepository } from './prisma-cost-center-repository.js';

describe('PrismaCostCenterRepository', () => {
  let stop: (() => Promise<void>) | undefined;
  let disconnect: (() => Promise<void>) | undefined;
  let repository: PrismaCostCenterRepository | undefined;

  beforeAll(async (): Promise<void> => {
    const container = await new PostgreSqlContainer('postgres:17-alpine')
      .withDatabase('seshat_test')
      .withUsername('seshat_test')
      .withPassword('synthetic-test-password')
      .start();
    stop = async (): Promise<void> => container.stop().then(() => undefined);
    const migration = await readFile(
      new URL(
        '../../prisma/migrations/20260920210000_create_cost_centers/migration.sql',
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
    repository = new PrismaCostCenterRepository(prisma);
  }, 60_000);

  afterAll(async (): Promise<void> => {
    await disconnect?.();
    await stop?.();
  });

  it('round-trips owned cost centers and uses optimistic concurrency', async () => {
    if (repository === undefined) {
      throw new Error('Repository was not initialized.');
    }
    const value = CostCenter.create({
      createdAt: new Date('2026-09-20T12:00:00.000Z'),
      id: '7c2c7a54-73fe-49a3-b0ea-19034bf22baf',
      name: 'Casa',
      ownerId: 'b36bfe2a-f319-49a8-aade-2a536ea3af38',
    });

    await repository.insert(value);

    await expect(repository.listForOwner(value.ownerId)).resolves.toHaveLength(
      1,
    );
    await expect(
      repository.findByIdForOwner(
        value.id,
        'e89b6ad0-7838-4a2c-9a21-c775ea78e22a',
      ),
    ).resolves.toBeNull();
    const restored = await repository.findByIdForOwner(value.id, value.ownerId);
    expect(restored?.toSnapshot()).toEqual(value.toSnapshot());

    if (restored === null) throw new Error('Cost center was not restored.');
    restored.rename('Família', new Date('2026-09-20T13:00:00.000Z'));
    await expect(repository.save(restored, 1)).resolves.toBe(true);
    await expect(repository.save(restored, 1)).resolves.toBe(false);
  });
});
