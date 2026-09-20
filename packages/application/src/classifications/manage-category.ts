import { Category } from '@seshat/domain';

import type { Clock } from '../ports/clock.js';
import type { IdentifierGenerator } from '../ports/identifier-generator.js';

export interface CategoryRepository {
  insert(category: Category): Promise<void>;
  findByIdForOwner(id: string, ownerId: string): Promise<Category | null>;
  listForOwner(ownerId: string): Promise<readonly Category[]>;
  save(category: Category, expectedVersion: number): Promise<boolean>;
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
      if (parent?.parentCategoryId !== null) {
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
    await this.categories.insert(category);
    return category;
  }
}

export class ListOwnedCategoriesUseCase {
  public constructor(private readonly categories: CategoryRepository) {}

  public execute(actorId: string): Promise<readonly Category[]> {
    return this.categories.listForOwner(actorId);
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
