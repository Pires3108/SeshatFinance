export type CategorySnapshot = Readonly<{
  createdAt: Date;
  id: string;
  name: string;
  ownerId: string;
  parentCategoryId: string | null;
  updatedAt: Date;
  version: number;
}>;

export type CreateCategoryProperties = Readonly<{
  createdAt: Date;
  id: string;
  name: string;
  ownerId: string;
  parentCategoryId: string | null;
}>;

export class InvalidCategoryError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'InvalidCategoryError';
  }
}

export class Category {
  private constructor(private state: CategorySnapshot) {}

  public static create(properties: CreateCategoryProperties): Category {
    assertRequiredText(properties.id, 'Category id');
    assertRequiredText(properties.ownerId, 'Category owner id');
    assertRequiredText(properties.name, 'Category name');
    assertValidInstant(properties.createdAt, 'Category creation instant');
    assertValidParent(properties.id, properties.parentCategoryId);

    return new Category({
      createdAt: new Date(properties.createdAt),
      id: properties.id,
      name: properties.name.trim(),
      ownerId: properties.ownerId,
      parentCategoryId: normalizeOptionalText(properties.parentCategoryId),
      updatedAt: new Date(properties.createdAt),
      version: 1,
    });
  }

  public static restore(snapshot: CategorySnapshot): Category {
    validateSnapshot(snapshot);
    return new Category(copySnapshot(snapshot));
  }

  public get id(): string {
    return this.state.id;
  }

  public get ownerId(): string {
    return this.state.ownerId;
  }

  public get parentCategoryId(): string | null {
    return this.state.parentCategoryId;
  }

  public rename(name: string, at: Date): void {
    assertRequiredText(name, 'Category name');
    assertValidInstant(at, 'Category update instant');
    if (at < this.state.updatedAt) {
      throw new InvalidCategoryError(
        'Category update cannot precede the previous update.',
      );
    }
    this.state = {
      ...this.state,
      name: name.trim(),
      updatedAt: new Date(at),
      version: this.state.version + 1,
    };
  }

  public toSnapshot(): CategorySnapshot {
    return copySnapshot(this.state);
  }
}

function validateSnapshot(snapshot: CategorySnapshot): void {
  assertRequiredText(snapshot.id, 'Category id');
  assertRequiredText(snapshot.ownerId, 'Category owner id');
  assertRequiredText(snapshot.name, 'Category name');
  assertValidInstant(snapshot.createdAt, 'Category creation instant');
  assertValidInstant(snapshot.updatedAt, 'Category update instant');
  assertValidParent(snapshot.id, snapshot.parentCategoryId);
  if (snapshot.updatedAt < snapshot.createdAt) {
    throw new InvalidCategoryError('Category update cannot precede creation.');
  }
  if (!Number.isSafeInteger(snapshot.version) || snapshot.version < 1) {
    throw new InvalidCategoryError(
      'Category version must be a positive integer.',
    );
  }
}

function assertValidParent(id: string, parentCategoryId: string | null): void {
  const normalizedParent = normalizeOptionalText(parentCategoryId);
  if (normalizedParent === id.trim()) {
    throw new InvalidCategoryError('A category cannot be its own parent.');
  }
}

function assertRequiredText(value: string, label: string): void {
  if (value.trim().length === 0) {
    throw new InvalidCategoryError(`${label} is required.`);
  }
}

function assertValidInstant(value: Date, label: string): void {
  if (Number.isNaN(value.getTime())) {
    throw new InvalidCategoryError(`${label} must be valid.`);
  }
}

function normalizeOptionalText(value: string | null): string | null {
  const normalized = value?.trim() ?? '';
  return normalized.length === 0 ? null : normalized;
}

function copySnapshot(snapshot: CategorySnapshot): CategorySnapshot {
  return {
    ...snapshot,
    createdAt: new Date(snapshot.createdAt),
    updatedAt: new Date(snapshot.updatedAt),
  };
}
