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
    await migrationClient.query(
      `INSERT INTO cost_centers (id, owner_id, name, updated_at) VALUES
       ('abe58149-7a1e-4c94-a117-a451fd1e32f0', '7c8aa690-0c3d-41e9-8844-ec199d1308f2', 'Legacy', now()),
       ('f8bb2b96-d5e9-4c65-bbaa-7e845540eb5f', '7c8aa690-0c3d-41e9-8844-ec199d1308f2', 'legacy', now())`,
    );
    const lifecycleMigration = await readFile(
      new URL(
        '../../prisma/migrations/20261021120000_cost_center_lifecycle/migration.sql',
        import.meta.url,
      ),
      'utf8',
    );
    await migrationClient.query(lifecycleMigration);
    await migrationClient.query(`CREATE TABLE transactions (
      id UUID NOT NULL PRIMARY KEY,
      owner_id UUID NOT NULL,
      cost_center_id UUID
    )`);
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

  it('preserves legacy duplicates while allowing archive and restore', async () => {
    if (repository === undefined)
      throw new Error('Repository was not initialized.');
    const ownerId = '7c8aa690-0c3d-41e9-8844-ec199d1308f2';
    const values = await repository.listForOwner(ownerId);
    expect(values.map((value) => value.toSnapshot().name).sort()).toEqual([
      'Legacy',
      'legacy',
    ]);
    const legacy = values.find(
      (value) => value.id === 'abe58149-7a1e-4c94-a117-a451fd1e32f0',
    );
    if (legacy === undefined)
      throw new Error('Legacy center was not restored.');
    legacy.setArchived(
      true,
      new Date(legacy.toSnapshot().updatedAt.getTime() + 1_000),
    );
    await expect(repository.save(legacy, 1)).resolves.toBe(true);
    legacy.setArchived(
      false,
      new Date(legacy.toSnapshot().updatedAt.getTime() + 1_000),
    );
    await expect(repository.save(legacy, 2)).resolves.toBe(true);
  });

  it('rejects normalized duplicates, including archived centers, under concurrent inserts', async () => {
    if (repository === undefined)
      throw new Error('Repository was not initialized.');
    const ownerId = '9f275af8-ad74-4c44-a90f-8ef8c514b87c';
    const first = CostCenter.create({
      createdAt: new Date('2026-09-20T12:00:00.000Z'),
      id: '3579171e-1585-45d0-8731-2dc0dd0663b3',
      name: 'Casa',
      ownerId,
    });
    const second = CostCenter.create({
      createdAt: new Date('2026-09-20T12:00:00.000Z'),
      id: 'd897cf20-26dc-493d-a420-37984c0cad2b',
      name: ' casa ',
      ownerId,
    });
    const results = await Promise.allSettled([
      repository.insert(first),
      repository.insert(second),
    ]);
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === 'rejected'),
    ).toHaveLength(1);
    const inserted = (await repository.listForOwner(ownerId))[0];
    if (inserted === undefined) throw new Error('No center was inserted.');
    inserted.setArchived(true, new Date('2026-09-20T13:00:00.000Z'));
    await expect(repository.save(inserted, 1)).resolves.toBe(true);
    const third = CostCenter.create({
      createdAt: new Date('2026-09-20T14:00:00.000Z'),
      id: '19e3b57f-aa40-46f0-bf1b-66891735a4c8',
      name: 'CASA',
      ownerId,
    });
    await expect(repository.insert(third)).rejects.toThrow();
  });

  it('deletes only an unlinked center owned by the actor at its current version', async () => {
    if (repository === undefined)
      throw new Error('Repository was not initialized.');
    const ownerId = '7f150fce-743d-42da-8e20-0a91ae6b11a4';
    const value = CostCenter.create({
      createdAt: new Date('2026-09-20T12:00:00.000Z'),
      id: 'c40f81eb-7dd5-4b36-8ae5-2c669ca656b6',
      name: 'Livre',
      ownerId,
    });
    await repository.insert(value);
    await expect(
      repository.deleteUnlinked(
        value.id,
        '474ddbea-a8b5-4f84-9636-81d03f743bca',
        1,
      ),
    ).resolves.toBe('conflict');
    await expect(repository.deleteUnlinked(value.id, ownerId, 2)).resolves.toBe(
      'conflict',
    );
    await expect(repository.deleteUnlinked(value.id, ownerId, 1)).resolves.toBe(
      'deleted',
    );
  });
});
