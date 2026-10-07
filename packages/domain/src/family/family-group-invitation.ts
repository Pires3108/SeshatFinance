import type { FamilyGroupRole } from './family-group.js';

export const familyGroupInvitationStatuses = [
  'pending',
  'accepted',
  'revoked',
] as const;

export type FamilyGroupInvitationStatus =
  (typeof familyGroupInvitationStatuses)[number];

export type FamilyGroupInvitationSnapshot = Readonly<{
  id: string;
  groupId: string;
  invitedBy: string;
  email: string;
  role: Exclude<FamilyGroupRole, 'owner'>;
  tokenHash: string;
  createdAt: Date;
  expiresAt: Date;
  status: FamilyGroupInvitationStatus;
  acceptedAt?: Date;
  acceptedUserId?: string;
}>;

export class InvalidFamilyGroupInvitationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'InvalidFamilyGroupInvitationError';
  }
}

export class FamilyGroupInvitation {
  private constructor(private readonly state: FamilyGroupInvitationSnapshot) {}

  public static create(
    properties: FamilyGroupInvitationSnapshot,
  ): FamilyGroupInvitation {
    assertText(properties.id, 'Invitation id');
    assertText(properties.groupId, 'Invitation group id');
    assertText(properties.invitedBy, 'Invitation actor');
    const email = normalizeEmail(properties.email);
    assertText(properties.tokenHash, 'Invitation token hash');
    assertInstant(properties.createdAt, 'Invitation creation instant');
    assertInstant(properties.expiresAt, 'Invitation expiration instant');
    if (properties.expiresAt.getTime() <= properties.createdAt.getTime()) {
      throw new InvalidFamilyGroupInvitationError(
        'Invitation expiration must be after creation.',
      );
    }
    if (!familyGroupInvitationStatuses.includes(properties.status)) {
      throw new InvalidFamilyGroupInvitationError(
        'Invitation status is invalid.',
      );
    }
    const normalized: FamilyGroupInvitationSnapshot = {
      ...properties,
      email,
      createdAt: new Date(properties.createdAt),
      expiresAt: new Date(properties.expiresAt),
    };
    const complete = properties.acceptedAt
      ? { ...normalized, acceptedAt: new Date(properties.acceptedAt) }
      : normalized;
    return new FamilyGroupInvitation(complete);
  }

  public static restore(
    snapshot: FamilyGroupInvitationSnapshot,
  ): FamilyGroupInvitation {
    return FamilyGroupInvitation.create(snapshot);
  }

  public toSnapshot(): FamilyGroupInvitationSnapshot {
    const snapshot: FamilyGroupInvitationSnapshot = {
      ...this.state,
      createdAt: new Date(this.state.createdAt),
      expiresAt: new Date(this.state.expiresAt),
    };
    return this.state.acceptedAt
      ? { ...snapshot, acceptedAt: new Date(this.state.acceptedAt) }
      : snapshot;
  }
}

function normalizeEmail(value: string): string {
  const email = value.trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(email)) {
    throw new InvalidFamilyGroupInvitationError('Invitation email is invalid.');
  }
  return email;
}

function assertText(value: string, label: string): void {
  if (value.trim().length === 0)
    throw new InvalidFamilyGroupInvitationError(`${label} is required.`);
}

function assertInstant(value: Date, label: string): void {
  if (Number.isNaN(value.getTime()))
    throw new InvalidFamilyGroupInvitationError(`${label} must be valid.`);
}
