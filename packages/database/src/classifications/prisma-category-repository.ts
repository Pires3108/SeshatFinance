import {
  DuplicateCategoryError,
  InvalidCategoryParentError,
  type CategoryRepository,
} from '@seshat/application';
import { Category } from '@seshat/domain';
import { randomUUID } from 'node:crypto';

import type { PrismaClient } from '../generated/prisma/client.js';

export class PrismaCategoryRepository implements CategoryRepository {
  public constructor(private readonly client: PrismaClient) {}

  public async insert(category: Category): Promise<void> {
    const snapshot = category.toSnapshot();
    try {
      await this.client.$transaction(async (client) => {
        await lockOwner(client, snapshot.ownerId);
        if (snapshot.parentCategoryId !== null) {
          const parent = await client.$queryRaw<readonly { id: string }[]>`
          SELECT id FROM categories
          WHERE id = ${snapshot.parentCategoryId}::uuid AND owner_id = ${snapshot.ownerId}::uuid
            AND parent_category_id IS NULL AND archived_at IS NULL
          FOR SHARE`;
          if (parent.length !== 1) throw new InvalidCategoryParentError();
        }
        if (
          await hasDuplicateName(
            client,
            snapshot.ownerId,
            snapshot.parentCategoryId,
            snapshot.name,
            snapshot.id,
          )
        ) {
          throw new DuplicateCategoryError();
        }
        await client.category.create({ data: snapshot });
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new DuplicateCategoryError();
      throw error;
    }
  }

  public async ensureInitialCatalog(ownerId: string): Promise<void> {
    const roots = [
      {
        name: 'Receitas',
        children: ['Salário', 'Rendimentos', 'Outras receitas'],
      },
      {
        name: 'Despesas',
        children: [
          'Moradia',
          'Alimentação',
          'Transporte',
          'Saúde',
          'Educação',
          'Lazer',
          'Outras despesas',
        ],
      },
    ];
    await this.client.$transaction(async (client) => {
      await lockOwner(client, ownerId);
      const installed = await client.categoryCatalogInstallation.findUnique({
        where: { ownerId },
      });
      if (installed !== null) return;
      const now = new Date();
      for (const root of roots) {
        const existingRootId = await findActiveName(
          client,
          ownerId,
          null,
          root.name,
        );
        const rootId = existingRootId ?? randomUUID();
        if (existingRootId === null)
          await client.category.create({
            data: {
              id: rootId,
              ownerId,
              name: root.name,
              parentCategoryId: null,
              updatedAt: now,
            },
          });
        for (const name of root.children) {
          const childId = await findActiveName(client, ownerId, rootId, name);
          if (childId === null)
            await client.category.create({
              data: {
                id: randomUUID(),
                ownerId,
                name,
                parentCategoryId: rootId,
                updatedAt: now,
              },
            });
        }
      }
      await client.categoryCatalogInstallation.create({
        data: { ownerId, version: 1 },
      });
    });
  }

  public async findByIdForOwner(
    id: string,
    ownerId: string,
  ): Promise<Category | null> {
    const persisted = await this.client.category.findFirst({
      where: { id, ownerId },
    });
    return persisted === null ? null : Category.restore(persisted);
  }

  public async listForOwner(ownerId: string): Promise<readonly Category[]> {
    const persisted = await this.client.category.findMany({
      orderBy: [{ parentCategoryId: 'asc' }, { name: 'asc' }, { id: 'asc' }],
      take: 500,
      where: { ownerId },
    });
    return persisted.map((category) => Category.restore(category));
  }

  public async save(
    category: Category,
    expectedVersion: number,
  ): Promise<boolean> {
    const snapshot = category.toSnapshot();
    let result;
    try {
      result = await this.client.$transaction(async (client) => {
        await lockOwner(client, snapshot.ownerId);
        if (
          snapshot.archivedAt == null &&
          (await hasDuplicateName(
            client,
            snapshot.ownerId,
            snapshot.parentCategoryId,
            snapshot.name,
            snapshot.id,
          ))
        ) {
          throw new DuplicateCategoryError();
        }
        return client.category.updateMany({
          data: {
            archivedAt: snapshot.archivedAt ?? null,
            name: snapshot.name,
            updatedAt: snapshot.updatedAt,
            version: snapshot.version,
          },
          where: {
            id: snapshot.id,
            ownerId: snapshot.ownerId,
            version: expectedVersion,
          },
        });
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new DuplicateCategoryError();
      throw error;
    }
    return result.count === 1;
  }

  public async deleteUnlinked(
    id: string,
    ownerId: string,
    expectedVersion: number,
  ): Promise<'deleted' | 'linked' | 'conflict'> {
    try {
      return await this.client.$transaction(async (client) => {
        await client.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${id}), 26)::text`;
        const category = await client.category.findFirst({
          where: { id, ownerId },
          select: { version: true },
        });
        if (category?.version !== expectedVersion) return 'conflict';
        const [children, transactions] = await Promise.all([
          client.category.count({ where: { ownerId, parentCategoryId: id } }),
          client.transaction.count({
            where: { ownerId, OR: [{ categoryId: id }, { subcategoryId: id }] },
          }),
        ]);
        if (children > 0 || transactions > 0) return 'linked';
        const result = await client.category.deleteMany({
          where: { id, ownerId, version: expectedVersion },
        });
        return result.count === 1 ? 'deleted' : 'conflict';
      });
    } catch (error) {
      if (isForeignKeyViolation(error)) return 'linked';
      throw error;
    }
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'P2002'
  );
}

function isForeignKeyViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'P2003'
  );
}

type QueryClient = Pick<PrismaClient, '$queryRaw'>;

async function lockOwner(client: QueryClient, ownerId: string): Promise<void> {
  await client.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${ownerId}), 25)::text`;
}

async function hasDuplicateName(
  client: QueryClient,
  ownerId: string,
  parentCategoryId: string | null,
  name: string,
  excludeId: string,
): Promise<boolean> {
  const matches = await client.$queryRaw<readonly { id: string }[]>`
    SELECT id FROM categories
    WHERE owner_id = ${ownerId}::uuid
      AND parent_category_id IS NOT DISTINCT FROM ${parentCategoryId}::uuid
      AND lower(trim(name)) = lower(trim(${name}))
      AND archived_at IS NULL
      AND id <> ${excludeId}::uuid
    LIMIT 1`;
  return matches.length > 0;
}

async function findActiveName(
  client: QueryClient,
  ownerId: string,
  parentCategoryId: string | null,
  name: string,
): Promise<string | null> {
  const matches = await client.$queryRaw<readonly { id: string }[]>`
    SELECT id FROM categories
    WHERE owner_id = ${ownerId}::uuid
      AND parent_category_id IS NOT DISTINCT FROM ${parentCategoryId}::uuid
      AND lower(trim(name)) = lower(trim(${name}))
      AND archived_at IS NULL
    ORDER BY created_at, id
    LIMIT 1`;
  return matches[0]?.id ?? null;
}
