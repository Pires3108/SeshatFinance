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
  let connectionUri: string | undefined;

  beforeAll(async (): Promise<void> => {
    const container = await new PostgreSqlContainer('postgres:17-alpine')
      .withDatabase('seshat_test')
      .withUsername('seshat_test')
      .withPassword('synthetic-test-password')
      .start();
    stop = async (): Promise<void> => container.stop().then(() => undefined);
    connectionUri = container.getConnectionUri();
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
    await migrationClient.query(
      `INSERT INTO categories (id, owner_id, name, updated_at) VALUES
       ('a1696f0f-529a-49a0-b601-84b34e8a74b2', 'f27c06d2-4a03-4636-a99f-768d5bc53e7f', 'Legacy', now()),
       ('1a2b2ee8-0fc7-46c3-a7e7-93f809b4b5e8', 'f27c06d2-4a03-4636-a99f-768d5bc53e7f', 'legacy', now())`,
    );
    const lifecycleMigration = await readFile(
      new URL(
        '../../prisma/migrations/20261020120000_category_catalog_lifecycle/migration.sql',
        import.meta.url,
      ),
      'utf8',
    );
    await migrationClient.query(lifecycleMigration);
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

  it('preserves legacy duplicate names while applying the lifecycle migration', async () => {
    if (repository === undefined)
      throw new Error('Repository was not initialized.');
    const categories = await repository.listForOwner(
      'f27c06d2-4a03-4636-a99f-768d5bc53e7f',
    );
    expect(categories.map((value) => value.toSnapshot().name).sort()).toEqual([
      'Legacy',
      'legacy',
    ]);
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

  it('installs the versioned starter catalog once for each owner', async () => {
    if (repository === undefined)
      throw new Error('Repository was not initialized.');
    const ownerId = '09c81cac-7a10-436d-9131-c7e69399a52d';
    const otherId = '2addcdb5-7b94-4d24-bd9f-b96affd8817a';

    await Promise.all([
      repository.ensureInitialCatalog(ownerId),
      repository.ensureInitialCatalog(ownerId),
    ]);
    const first = await repository.listForOwner(ownerId);
    expect(first).toHaveLength(12);
    expect(
      first
        .filter((value) => value.parentCategoryId === null)
        .map((value) => value.toSnapshot().name)
        .sort(),
    ).toEqual(['Despesas', 'Receitas']);
    await repository.ensureInitialCatalog(ownerId);
    expect(
      (await repository.listForOwner(ownerId)).map((value) => value.id),
    ).toEqual(first.map((value) => value.id));

    await repository.ensureInitialCatalog(otherId);
    const other = await repository.listForOwner(otherId);
    expect(other).toHaveLength(12);
    expect(
      other.every(
        (value) => !first.some((original) => original.id === value.id),
      ),
    ).toBe(true);
  });

  it('copies active v1 entries when legacy names are archived without rewriting history', async () => {
    if (repository === undefined)
      throw new Error('Repository was not initialized.');
    const ownerId = '7d09d879-84d1-4aa3-978f-43aa62e55068';
    const createdAt = new Date('2026-09-20T12:00:00.000Z');
    const archivedAt = new Date('2026-09-20T13:00:00.000Z');
    const legacyRoot = Category.create({
      createdAt,
      id: '8eb32145-9298-4c57-a448-afbd764fdf0f',
      name: 'Receitas',
      ownerId,
      parentCategoryId: null,
    });
    const legacyChild = Category.create({
      createdAt,
      id: '56e9e274-6a96-43f5-8c9f-c5222a1a6f37',
      name: 'Salário',
      ownerId,
      parentCategoryId: legacyRoot.id,
    });
    await repository.insert(legacyRoot);
    await repository.insert(legacyChild);
    legacyChild.setArchived(true, archivedAt);
    await repository.save(legacyChild, 1);
    legacyRoot.setArchived(true, archivedAt);
    await repository.save(legacyRoot, 1);
    const rootBefore = legacyRoot.toSnapshot();
    const childBefore = legacyChild.toSnapshot();

    await repository.ensureInitialCatalog(ownerId);

    const categories = await repository.listForOwner(ownerId);
    expect(categories).toHaveLength(14);
    expect(
      categories.find((value) => value.id === legacyRoot.id)?.toSnapshot(),
    ).toEqual(rootBefore);
    expect(
      categories.find((value) => value.id === legacyChild.id)?.toSnapshot(),
    ).toEqual(childBefore);
    const activeRoot = categories.find(
      (value) =>
        value.parentCategoryId === null &&
        value.toSnapshot().name === 'Receitas' &&
        !value.isArchived,
    );
    expect(activeRoot).toBeDefined();
    expect(activeRoot?.id).not.toBe(legacyRoot.id);
    const activeChild = categories.find(
      (value) =>
        value.parentCategoryId === activeRoot?.id &&
        value.toSnapshot().name === 'Salário' &&
        !value.isArchived,
    );
    expect(activeChild).toBeDefined();
    expect(activeChild?.id).not.toBe(legacyChild.id);

    await repository.ensureInitialCatalog(ownerId);
    expect(
      (await repository.listForOwner(ownerId)).map((value) => value.id),
    ).toEqual(categories.map((value) => value.id));
  });

  it('rejects duplicate names at the same level and keeps children when deleting a root', async () => {
    if (repository === undefined)
      throw new Error('Repository was not initialized.');
    const ownerId = '06e6ded1-2e4f-4b57-a710-5b63275d8ddc';
    const root = Category.create({
      createdAt: new Date('2026-09-20T12:00:00.000Z'),
      id: 'cb83947e-f839-46a3-b3df-9fc32a035bde',
      name: 'Custom',
      ownerId,
      parentCategoryId: null,
    });
    const duplicate = Category.create({
      createdAt: new Date('2026-09-20T12:00:00.000Z'),
      id: '731b4696-b22c-41cb-b3fa-e5866d636ead',
      name: 'custom',
      ownerId,
      parentCategoryId: null,
    });
    const child = Category.create({
      createdAt: new Date('2026-09-20T12:00:00.000Z'),
      id: 'd3e8eae9-23db-4cb2-959a-a1ae4ba3ed9d',
      name: 'Child',
      ownerId,
      parentCategoryId: root.id,
    });

    await repository.insert(root);
    await expect(repository.insert(duplicate)).rejects.toThrow();
    await repository.insert(child);
    await expect(repository.deleteUnlinked(root.id, ownerId, 1)).resolves.toBe(
      'linked',
    );
    await expect(
      repository.findByIdForOwner(child.id, ownerId),
    ).resolves.not.toBeNull();
    await expect(repository.deleteUnlinked(child.id, ownerId, 1)).resolves.toBe(
      'deleted',
    );
    await expect(repository.deleteUnlinked(root.id, ownerId, 1)).resolves.toBe(
      'deleted',
    );
  });

  it('preserves archived categories and rejects a stale lifecycle write', async () => {
    if (repository === undefined)
      throw new Error('Repository was not initialized.');
    const ownerId = 'f6988068-7123-4d6d-9c0e-b69a6719eeb0';
    const value = Category.create({
      createdAt: new Date('2026-09-20T12:00:00.000Z'),
      id: '3ec25d81-4620-41b7-8278-b185a19a51a4',
      name: 'Historical',
      ownerId,
      parentCategoryId: null,
    });

    await repository.insert(value);
    value.setArchived(true, new Date('2026-09-20T13:00:00.000Z'));
    await expect(repository.save(value, 1)).resolves.toBe(true);
    await expect(repository.save(value, 1)).resolves.toBe(false);
    const restored = await repository.findByIdForOwner(value.id, ownerId);
    expect(restored?.toSnapshot()).toEqual(value.toSnapshot());
    expect(
      (await repository.listForOwner(ownerId)).map((item) => item.id),
    ).toContain(value.id);
  });

  it('serializes archiving before concurrent child creation', async () => {
    if (repository === undefined || connectionUri === undefined)
      throw new Error('Repository was not initialized.');
    const ownerId = '19e3b57f-aa40-46f0-bf1b-66891735a4c8';
    const root = Category.create({
      createdAt: new Date('2026-09-20T12:00:00.000Z'),
      id: 'b6c95d4f-ae83-4e8b-94ab-5d07c50c37f0',
      name: 'Root',
      ownerId,
      parentCategoryId: null,
    });
    const child = Category.create({
      createdAt: new Date('2026-09-20T12:01:00.000Z'),
      id: '2f1257a4-1028-4865-b51e-5946e6de51e7',
      name: 'Child',
      ownerId,
      parentCategoryId: root.id,
    });
    await repository.insert(root);
    root.setArchived(true, new Date('2026-09-20T13:00:00.000Z'));

    const blocker = new Client({ connectionString: connectionUri });
    await blocker.connect();
    try {
      await blocker.query('BEGIN');
      await blocker.query(
        'SELECT id FROM categories WHERE id = $1 FOR UPDATE',
        [root.id],
      );
      const archive = repository.save(root, 1);
      await waitForAnotherAdvisoryLock(blocker);
      const createChild = repository.insert(child);
      await blocker.query('COMMIT');

      await expect(archive).resolves.toBe(true);
      await expect(createChild).rejects.toThrow();
      await expect(
        repository.findByIdForOwner(child.id, ownerId),
      ).resolves.toBeNull();
    } finally {
      await blocker.query('ROLLBACK');
      await blocker.end();
    }
  });
});

async function waitForAnotherAdvisoryLock(client: Client): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const result = await client.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM pg_locks WHERE locktype = 'advisory' AND granted AND pid <> pg_backend_pid()",
    );
    if (Number(result.rows[0]?.count) > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Concurrent archive did not acquire its advisory lock.');
}
