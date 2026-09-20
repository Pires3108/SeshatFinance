export type TagSnapshot = Readonly<{
  createdAt: Date;
  id: string;
  name: string;
  ownerId: string;
  updatedAt: Date;
  version: number;
}>;

export type CreateTagProperties = Readonly<{
  createdAt: Date;
  id: string;
  name: string;
  ownerId: string;
}>;

export class InvalidTagError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'InvalidTagError';
  }
}

export class Tag {
  private constructor(private state: TagSnapshot) {}

  public static create(properties: CreateTagProperties): Tag {
    assertRequiredText(properties.id, 'Tag id');
    assertRequiredText(properties.ownerId, 'Tag owner id');
    assertRequiredText(properties.name, 'Tag name');
    assertValidInstant(properties.createdAt, 'Tag creation instant');
    return new Tag({
      createdAt: new Date(properties.createdAt),
      id: properties.id,
      name: properties.name.trim(),
      ownerId: properties.ownerId,
      updatedAt: new Date(properties.createdAt),
      version: 1,
    });
  }

  public static restore(snapshot: TagSnapshot): Tag {
    validateSnapshot(snapshot);
    return new Tag(copySnapshot(snapshot));
  }

  public get id(): string {
    return this.state.id;
  }

  public get ownerId(): string {
    return this.state.ownerId;
  }

  public rename(name: string, at: Date): void {
    assertRequiredText(name, 'Tag name');
    assertValidInstant(at, 'Tag update instant');
    if (at < this.state.updatedAt) {
      throw new InvalidTagError(
        'Tag update cannot precede the previous update.',
      );
    }
    this.state = {
      ...this.state,
      name: name.trim(),
      updatedAt: new Date(at),
      version: this.state.version + 1,
    };
  }

  public toSnapshot(): TagSnapshot {
    return copySnapshot(this.state);
  }
}

function validateSnapshot(snapshot: TagSnapshot): void {
  assertRequiredText(snapshot.id, 'Tag id');
  assertRequiredText(snapshot.ownerId, 'Tag owner id');
  assertRequiredText(snapshot.name, 'Tag name');
  assertValidInstant(snapshot.createdAt, 'Tag creation instant');
  assertValidInstant(snapshot.updatedAt, 'Tag update instant');
  if (snapshot.updatedAt < snapshot.createdAt) {
    throw new InvalidTagError('Tag update cannot precede creation.');
  }
  if (!Number.isSafeInteger(snapshot.version) || snapshot.version < 1) {
    throw new InvalidTagError('Tag version must be a positive integer.');
  }
}

function assertRequiredText(value: string, label: string): void {
  if (value.trim().length === 0) {
    throw new InvalidTagError(`${label} is required.`);
  }
}

function assertValidInstant(value: Date, label: string): void {
  if (Number.isNaN(value.getTime())) {
    throw new InvalidTagError(`${label} must be valid.`);
  }
}

function copySnapshot(snapshot: TagSnapshot): TagSnapshot {
  return {
    ...snapshot,
    createdAt: new Date(snapshot.createdAt),
    updatedAt: new Date(snapshot.updatedAt),
  };
}
