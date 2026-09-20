import { Category } from '@seshat/domain';
import { describe, expect, it } from 'vitest';

import {
  CategoryVersionConflictError,
  CreateCategoryUseCase,
  InvalidCategoryParentError,
  RenameOwnedCategoryUseCase,
  type CategoryRepository,
} from './manage-category.js';

const now = new Date('2026-09-20T12:00:00.000Z');

function repository(values: readonly Category[]): CategoryRepository {
  return {
    findByIdForOwner: (id, ownerId): Promise<Category | null> =>
      Promise.resolve(
        values.find(
          (category) => category.id === id && category.ownerId === ownerId,
        ) ?? null,
      ),
    insert: (): Promise<void> => Promise.resolve(),
    listForOwner: (): Promise<readonly Category[]> => Promise.resolve(values),
    save: (): Promise<boolean> => Promise.resolve(true),
  };
}

function category(
  id: string,
  ownerId: string,
  parentCategoryId: string | null,
): Category {
  return Category.create({
    createdAt: now,
    id,
    name: id,
    ownerId,
    parentCategoryId,
  });
}

describe('CreateCategoryUseCase', () => {
  it('creates a subcategory below an owned root category', async () => {
    const parent = category('parent-id', 'owner-id', null);
    const useCase = new CreateCategoryUseCase(
      repository([parent]),
      { now: () => now },
      { generate: () => 'subcategory-id' },
    );

    const created = await useCase.execute({
      actorId: 'owner-id',
      name: 'Mercado',
      parentCategoryId: parent.id,
    });

    expect(created.toSnapshot()).toMatchObject({
      id: 'subcategory-id',
      ownerId: 'owner-id',
      parentCategoryId: parent.id,
    });
  });

  it('rejects a parent owned by another actor', async () => {
    const parent = category('parent-id', 'other-owner-id', null);
    const useCase = new CreateCategoryUseCase(
      repository([parent]),
      { now: () => now },
      { generate: () => 'subcategory-id' },
    );

    await expect(
      useCase.execute({
        actorId: 'owner-id',
        name: 'Mercado',
        parentCategoryId: parent.id,
      }),
    ).rejects.toBeInstanceOf(InvalidCategoryParentError);
  });

  it('rejects nesting below a subcategory', async () => {
    const child = category('child-id', 'owner-id', 'parent-id');
    const useCase = new CreateCategoryUseCase(
      repository([child]),
      { now: () => now },
      { generate: () => 'grandchild-id' },
    );

    await expect(
      useCase.execute({
        actorId: 'owner-id',
        name: 'Nested',
        parentCategoryId: child.id,
      }),
    ).rejects.toBeInstanceOf(InvalidCategoryParentError);
  });
});

describe('RenameOwnedCategoryUseCase', () => {
  it('uses the persisted version for optimistic concurrency', async () => {
    const value = category('category-id', 'owner-id', null);
    let expectedVersion: number | undefined;
    const categories: CategoryRepository = {
      ...repository([value]),
      save: (_category, version): Promise<boolean> => {
        expectedVersion = version;
        return Promise.resolve(true);
      },
    };
    const useCase = new RenameOwnedCategoryUseCase(categories, {
      now: () => new Date('2026-09-20T13:00:00.000Z'),
    });

    const renamed = await useCase.execute({
      actorId: 'owner-id',
      categoryId: value.id,
      name: 'Novo nome',
    });

    expect(expectedVersion).toBe(1);
    expect(renamed.toSnapshot()).toMatchObject({
      name: 'Novo nome',
      version: 2,
    });
  });

  it('reports concurrent persistence changes', async () => {
    const value = category('category-id', 'owner-id', null);
    const categories: CategoryRepository = {
      ...repository([value]),
      save: (): Promise<boolean> => Promise.resolve(false),
    };
    const useCase = new RenameOwnedCategoryUseCase(categories, {
      now: () => new Date('2026-09-20T13:00:00.000Z'),
    });

    await expect(
      useCase.execute({
        actorId: 'owner-id',
        categoryId: value.id,
        name: 'Novo nome',
      }),
    ).rejects.toBeInstanceOf(CategoryVersionConflictError);
  });
});
