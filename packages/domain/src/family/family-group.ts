export const familyGroupRoles = [
  'owner',
  'administrator',
  'member',
  'viewer',
] as const;

export type FamilyGroupRole = (typeof familyGroupRoles)[number];

export type FamilyGroupSnapshot = Readonly<{
  createdAt: Date;
  id: string;
}>;

export type FamilyGroupMembershipSnapshot = Readonly<{
  groupId: string;
  joinedAt: Date;
  role: FamilyGroupRole;
  userId: string;
}>;

export class InvalidFamilyGroupError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'InvalidFamilyGroupError';
  }
}

export class FamilyGroup {
  private constructor(private readonly state: FamilyGroupSnapshot) {}

  public static create(properties: FamilyGroupSnapshot): FamilyGroup {
    assertRequiredText(properties.id, 'Family group id');
    assertValidInstant(properties.createdAt, 'Family group creation instant');
    return new FamilyGroup({
      createdAt: new Date(properties.createdAt),
      id: properties.id,
    });
  }

  public static restore(snapshot: FamilyGroupSnapshot): FamilyGroup {
    return FamilyGroup.create(snapshot);
  }

  public get id(): string {
    return this.state.id;
  }

  public toSnapshot(): FamilyGroupSnapshot {
    return { createdAt: new Date(this.state.createdAt), id: this.state.id };
  }
}

export class FamilyGroupMembership {
  private constructor(private readonly state: FamilyGroupMembershipSnapshot) {}

  public static createOwner(properties: {
    groupId: string;
    joinedAt: Date;
    userId: string;
  }): FamilyGroupMembership {
    return FamilyGroupMembership.create({ ...properties, role: 'owner' });
  }

  public static create(
    properties: FamilyGroupMembershipSnapshot,
  ): FamilyGroupMembership {
    assertRequiredText(properties.groupId, 'Family group membership group id');
    assertRequiredText(properties.userId, 'Family group membership user id');
    assertValidInstant(properties.joinedAt, 'Family group membership instant');
    if (!familyGroupRoles.includes(properties.role)) {
      throw new InvalidFamilyGroupError('Family group role is invalid.');
    }
    return new FamilyGroupMembership({
      ...properties,
      joinedAt: new Date(properties.joinedAt),
    });
  }

  public static restore(
    snapshot: FamilyGroupMembershipSnapshot,
  ): FamilyGroupMembership {
    return FamilyGroupMembership.create(snapshot);
  }

  public toSnapshot(): FamilyGroupMembershipSnapshot {
    return { ...this.state, joinedAt: new Date(this.state.joinedAt) };
  }
}

function assertRequiredText(value: string, label: string): void {
  if (value.trim().length === 0) {
    throw new InvalidFamilyGroupError(`${label} is required.`);
  }
}

function assertValidInstant(value: Date, label: string): void {
  if (Number.isNaN(value.getTime())) {
    throw new InvalidFamilyGroupError(`${label} must be valid.`);
  }
}
