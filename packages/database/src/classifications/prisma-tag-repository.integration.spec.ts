import { readFile } from 'node:fs/promises';

import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { Tag } from '@seshat/domain';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createPrismaClient } from '../prisma/create-prisma-client.js';
import { PrismaTagRepository } from './prisma-tag-repository.js';

describe('PrismaTagRepository', () => {
  let stop: (() => Promise<void>) | undefined;
  let disconnect: (() => Promise<void>) | undefined;
  let repository: PrismaTagRepository | undefined;

  beforeAll(async (): Promise<void> => {
    const container = await new PostgreSqlContainer('postgres:17-alpine')
      .withDatabase('seshat_test')
      .withUsername('seshat_test')
      .withPassword('synthetic-test-password')
      .start();
    stop = async (): Promise<void> => container.stop().then(() => undefined);
    const migration = await readFile(
      new URL(
        '../../prisma/migrations/20260920190000_create_tags/migration.sql',
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
      `INSERT INTO tags (id, owner_id, name, updated_at) VALUES
       ('aedf856e-6df1-4ce9-a29a-b6599899b700', '36b23696-9c6a-44fc-9000-4fdb82dad910', 'Legacy', now()),
       ('6bb49241-c5cc-4a9b-a38b-b5fd54d4004d', '36b23696-9c6a-44fc-9000-4fdb82dad910', 'legacy', now())`,
    );
    const lifecycleMigration = await readFile(
      new URL(
        '../../prisma/migrations/20261020130000_tag_lifecycle/migration.sql',
        import.meta.url,
      ),
      'utf8',
    );
    await migrationClient.query(lifecycleMigration);
    await migrationClient.end();
    const prisma = createPrismaClient(container.getConnectionUri());
    disconnect = async (): Promise<void> => prisma.$disconnect();
    repository = new PrismaTagRepository(prisma);
  }, 60_000);

  afterAll(async (): Promise<void> => {
    await disconnect?.();
    await stop?.();
  });

  it('round-trips owned tags and uses optimistic concurrency', async () => {
    if (repository === undefined) {
      throw new Error('Repository was not initialized.');
    }
    const value = Tag.create({
      createdAt: new Date('2026-09-20T12:00:00.000Z'),
      id: '7c2c7a54-73fe-49a3-b0ea-19034bf22baf',
      name: 'Essencial',
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

    if (restored === null) throw new Error('Tag was not restored.');
    restored.rename('Prioritário', new Date('2026-09-20T13:00:00.000Z'));
    await expect(repository.save(restored, 1)).resolves.toBe(true);
    await expect(repository.save(restored, 1)).resolves.toBe(false);
  });

  it('preserves legacy duplicates through migration but rejects new normalized duplicates', async () => {
    if (repository === undefined)
      throw new Error('Repository was not initialized.');
    const legacyOwner = '36b23696-9c6a-44fc-9000-4fdb82dad910';
    expect(
      (await repository.listForOwner(legacyOwner))
        .map((tag) => tag.toSnapshot().name)
        .sort(),
    ).toEqual(['Legacy', 'legacy']);
    const legacy = await repository.findByIdForOwner(
      'aedf856e-6df1-4ce9-a29a-b6599899b700',
      legacyOwner,
    );
    if (legacy === null) throw new Error('Legacy tag was not restored.');
    legacy.setArchived(
      true,
      new Date(legacy.toSnapshot().updatedAt.getTime() + 1_000),
    );
    await expect(repository.save(legacy, 1)).resolves.toBe(true);

    const ownerId = '59d7f851-936d-4b54-81a6-c020843da0bb';
    const original = Tag.create({
      createdAt: new Date('2026-09-20T12:00:00.000Z'),
      id: 'b27a1480-01b4-40a8-aed3-607fc14d3ad3',
      name: 'Viagem',
      ownerId,
    });
    const duplicate = Tag.create({
      createdAt: new Date('2026-09-20T12:00:00.000Z'),
      id: '0d7ed1e5-8678-4e76-a38b-a5950ce5c056',
      name: ' viagem ',
      ownerId,
    });
    await repository.insert(original);
    original.setArchived(true, new Date('2026-09-20T13:00:00.000Z'));
    await expect(repository.save(original, 1)).resolves.toBe(true);
    await expect(repository.insert(duplicate)).rejects.toThrow();
    expect(
      (await repository.findByIdForOwner(original.id, ownerId))?.toSnapshot(),
    ).toEqual(original.toSnapshot());
  });

  it('allows only one concurrent insert for the same normalized name', async () => {
    if (repository === undefined)
      throw new Error('Repository was not initialized.');
    const ownerId = '9f275af8-ad74-4c44-a90f-8ef8c514b87c';
    const first = Tag.create({
      createdAt: new Date('2026-09-20T12:00:00.000Z'),
      id: '3579171e-1585-45d0-8731-2dc0dd0663b3',
      name: 'Casa',
      ownerId,
    });
    const second = Tag.create({
      createdAt: new Date('2026-09-20T12:00:00.000Z'),
      id: 'd897cf20-26dc-493d-a420-37984c0cad2b',
      name: 'casa',
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
    await expect(repository.listForOwner(ownerId)).resolves.toHaveLength(1);
  });

  it('deletes only an unlinked owned tag and checks its version', async () => {
    if (repository === undefined)
      throw new Error('Repository was not initialized.');
    const ownerId = '7f150fce-743d-42da-8e20-0a91ae6b11a4';
    const value = Tag.create({
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
    await expect(
      repository.findByIdForOwner(value.id, ownerId),
    ).resolves.toBeNull();
  });
});
