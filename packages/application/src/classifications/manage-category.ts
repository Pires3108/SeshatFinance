import { Category } from '@seshat/domain';

import type { Clock } from '../ports/clock.js';
import type { IdentifierGenerator } from '../ports/identifier-generator.js';

export interface CategoryRepository {
  ensureInitialCatalog?(ownerId: string): Promise<void>;
  insert(category: Category): Promise<void>;
  findByIdForOwner(id: string, ownerId: string): Promise<Category | null>;
  listForOwner(ownerId: string): Promise<readonly Category[]>;
  save(category: Category, expectedVersion: number): Promise<boolean>;
  deleteUnlinked?(
    id: string,
    ownerId: string,
    expectedVersion: number,
  ): Promise<'deleted' | 'linked' | 'conflict'>;
}

export class DuplicateCategoryError extends Error {
  public constructor() {
    super('Category name already exists at this level.');
    this.name = 'DuplicateCategoryError';
  }
}

export class CategoryLinkedError extends Error {
  public constructor() {
    super('Category has children or financial links.');
    this.name = 'CategoryLinkedError';
  }
}

export type CreateCategoryCommand = Readonly<{
  actorId: string;
  name: string;
  parentCategoryId: string | null;
}>;

export class InvalidCategoryParentError extends Error {
  public constructor() {
    super('The parent must be an owned root category.');
    this.name = 'InvalidCategoryParentError';
  }
}

export class OwnedCategoryNotFoundError extends Error {
  public constructor() {
    super('Owned category was not found.');
    this.name = 'OwnedCategoryNotFoundError';
  }
}

export class CategoryVersionConflictError extends Error {
  public constructor() {
    super('Category was modified concurrently.');
    this.name = 'CategoryVersionConflictError';
  }
}

export class CreateCategoryUseCase {
  public constructor(
    private readonly categories: CategoryRepository,
    private readonly clock: Clock,
    private readonly identifiers: IdentifierGenerator,
  ) {}

  public async execute(command: CreateCategoryCommand): Promise<Category> {
    if (command.parentCategoryId !== null) {
      const parent = await this.categories.findByIdForOwner(
        command.parentCategoryId,
        command.actorId,
      );
      if (parent?.parentCategoryId !== null || parent.isArchived) {
        throw new InvalidCategoryParentError();
      }
    }
    const category = Category.create({
      createdAt: this.clock.now(),
      id: this.identifiers.generate(),
      name: command.name,
      ownerId: command.actorId,
      parentCategoryId: command.parentCategoryId,
    });
    await this.categories.ensureInitialCatalog?.(command.actorId);
    await this.categories.insert(category);
    return category;
  }
}

export class ListOwnedCategoriesUseCase {
  public constructor(private readonly categories: CategoryRepository) {}

  public async execute(actorId: string): Promise<readonly Category[]> {
    await this.categories.ensureInitialCatalog?.(actorId);
    return this.categories.listForOwner(actorId);
  }
}

export class GetOwnedCategoryUseCase {
  public constructor(private readonly categories: CategoryRepository) {}

  public async execute(command: {
    actorId: string;
    categoryId: string;
  }): Promise<Category> {
    await this.categories.ensureInitialCatalog?.(command.actorId);
    const category = await this.categories.findByIdForOwner(
      command.categoryId,
      command.actorId,
    );
    if (category === null) throw new OwnedCategoryNotFoundError();
    return category;
  }
}

export class SetOwnedCategoryArchivedUseCase {
  public constructor(
    private readonly categories: CategoryRepository,
    private readonly clock: Clock,
  ) {}

  public async execute(command: {
    actorId: string;
    categoryId: string;
    archived: boolean;
  }): Promise<Category> {
    const category = await this.categories.findByIdForOwner(
      command.categoryId,
      command.actorId,
    );
    if (category === null) throw new OwnedCategoryNotFoundError();
    if (category.isArchived === command.archived) return category;
    const expectedVersion = category.toSnapshot().version;
    category.setArchived(command.archived, this.clock.now());
    if (!(await this.categories.save(category, expectedVersion)))
      throw new CategoryVersionConflictError();
    return category;
  }
}

export class DeleteOwnedCategoryUseCase {
  public constructor(private readonly categories: CategoryRepository) {}

  public async execute(command: {
    actorId: string;
    categoryId: string;
  }): Promise<void> {
    const category = await this.categories.findByIdForOwner(
      command.categoryId,
      command.actorId,
    );
    if (category === null) throw new OwnedCategoryNotFoundError();
    if (this.categories.deleteUnlinked === undefined)
      throw new Error('Category deletion is unavailable.');
    const result = await this.categories.deleteUnlinked(
      category.id,
      command.actorId,
      category.toSnapshot().version,
    );
    if (result === 'linked') throw new CategoryLinkedError();
    if (result === 'conflict') throw new CategoryVersionConflictError();
  }
}

export class RenameOwnedCategoryUseCase {
  public constructor(
    private readonly categories: CategoryRepository,
    private readonly clock: Clock,
  ) {}

  public async execute(command: {
    actorId: string;
    categoryId: string;
    name: string;
  }): Promise<Category> {
    const category = await this.categories.findByIdForOwner(
      command.categoryId,
      command.actorId,
    );
    if (category === null) throw new OwnedCategoryNotFoundError();
    const expectedVersion = category.toSnapshot().version;
    category.rename(command.name, this.clock.now());
    if (!(await this.categories.save(category, expectedVersion))) {
      throw new CategoryVersionConflictError();
    }
    return category;
  }
}
