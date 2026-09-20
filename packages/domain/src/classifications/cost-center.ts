export type CostCenterSnapshot = Readonly<{
  createdAt: Date;
  id: string;
  name: string;
  ownerId: string;
  updatedAt: Date;
  version: number;
}>;

export type CreateCostCenterProperties = Readonly<{
  createdAt: Date;
  id: string;
  name: string;
  ownerId: string;
}>;

export class InvalidCostCenterError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'InvalidCostCenterError';
  }
}

export class CostCenter {
  private constructor(private state: CostCenterSnapshot) {}

  public static create(properties: CreateCostCenterProperties): CostCenter {
    assertRequiredText(properties.id, 'Cost center id');
    assertRequiredText(properties.ownerId, 'Cost center owner id');
    assertRequiredText(properties.name, 'Cost center name');
    assertValidInstant(properties.createdAt, 'Cost center creation instant');
    return new CostCenter({
      createdAt: new Date(properties.createdAt),
      id: properties.id,
      name: properties.name.trim(),
      ownerId: properties.ownerId,
      updatedAt: new Date(properties.createdAt),
      version: 1,
    });
  }

  public static restore(snapshot: CostCenterSnapshot): CostCenter {
    validateSnapshot(snapshot);
    return new CostCenter(copySnapshot(snapshot));
  }

  public get id(): string {
    return this.state.id;
  }

  public get ownerId(): string {
    return this.state.ownerId;
  }

  public rename(name: string, at: Date): void {
    assertRequiredText(name, 'Cost center name');
    assertValidInstant(at, 'Cost center update instant');
    if (at < this.state.updatedAt) {
      throw new InvalidCostCenterError(
        'Cost center update cannot precede the previous update.',
      );
    }
    this.state = {
      ...this.state,
      name: name.trim(),
      updatedAt: new Date(at),
      version: this.state.version + 1,
    };
  }

  public toSnapshot(): CostCenterSnapshot {
    return copySnapshot(this.state);
  }
}

function validateSnapshot(snapshot: CostCenterSnapshot): void {
  assertRequiredText(snapshot.id, 'Cost center id');
  assertRequiredText(snapshot.ownerId, 'Cost center owner id');
  assertRequiredText(snapshot.name, 'Cost center name');
  assertValidInstant(snapshot.createdAt, 'Cost center creation instant');
  assertValidInstant(snapshot.updatedAt, 'Cost center update instant');
  if (snapshot.updatedAt < snapshot.createdAt) {
    throw new InvalidCostCenterError(
      'Cost center update cannot precede creation.',
    );
  }
  if (!Number.isSafeInteger(snapshot.version) || snapshot.version < 1) {
    throw new InvalidCostCenterError(
      'Cost center version must be a positive integer.',
    );
  }
}

function assertRequiredText(value: string, label: string): void {
  if (value.trim().length === 0) {
    throw new InvalidCostCenterError(`${label} is required.`);
  }
}

function assertValidInstant(value: Date, label: string): void {
  if (Number.isNaN(value.getTime())) {
    throw new InvalidCostCenterError(`${label} must be valid.`);
  }
}

function copySnapshot(snapshot: CostCenterSnapshot): CostCenterSnapshot {
  return {
    ...snapshot,
    createdAt: new Date(snapshot.createdAt),
    updatedAt: new Date(snapshot.updatedAt),
  };
}
