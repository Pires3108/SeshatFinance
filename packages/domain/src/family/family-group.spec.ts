import { describe, expect, it } from 'vitest';

import { FamilyGroup, FamilyGroupMembership } from './family-group.js';
import {
  canChangeFamilyGroupRole,
  canInviteToFamilyGroup,
  canRemoveFamilyGroupMember,
  hasFamilyGroupCapability,
  type FamilyGroupCapability,
} from './family-group-policy.js';

describe('FamilyGroup', () => {
  it('creates an owner membership at the group creation instant', () => {
    const createdAt = new Date('2026-09-24T12:00:00.000Z');
    const group = FamilyGroup.create({ createdAt, id: 'group-id' });
    const membership = FamilyGroupMembership.createOwner({
      groupId: group.id,
      joinedAt: createdAt,
      userId: 'user-id',
    });

    expect(membership.toSnapshot()).toEqual({
      groupId: 'group-id',
      joinedAt: createdAt,
      role: 'owner',
      userId: 'user-id',
    });
  });

  it('keeps group-management capabilities exclusive to the owner', () => {
    expect(hasFamilyGroupCapability('owner', 'transfer-ownership')).toBe(true);
    expect(
      hasFamilyGroupCapability('administrator', 'transfer-ownership'),
    ).toBe(false);
    expect(hasFamilyGroupCapability('viewer', 'write-shared-data')).toBe(false);
  });

  it('enforces the shared-data permission matrix for every role', () => {
    const protectedActions: readonly FamilyGroupCapability[] = [
      'purge-shared-data',
      'archive-shared-account',
      'revert-shared-import',
      'read-all-audit',
    ];
    for (const action of protectedActions) {
      expect(hasFamilyGroupCapability('owner', action)).toBe(true);
      expect(hasFamilyGroupCapability('administrator', action)).toBe(true);
      expect(hasFamilyGroupCapability('member', action)).toBe(false);
      expect(hasFamilyGroupCapability('viewer', action)).toBe(false);
    }
    expect(hasFamilyGroupCapability('member', 'export-shared-data')).toBe(true);
    expect(hasFamilyGroupCapability('viewer', 'export-shared-data')).toBe(
      false,
    );
    expect(hasFamilyGroupCapability('member', 'read-own-audit')).toBe(true);
    expect(hasFamilyGroupCapability('viewer', 'read-own-audit')).toBe(false);
  });

  it('rejects invitations to owner and protects administrator promotion', () => {
    expect(canInviteToFamilyGroup('owner', 'owner')).toBe(false);
    expect(canInviteToFamilyGroup('administrator', 'administrator')).toBe(true);
    expect(canInviteToFamilyGroup('member', 'member')).toBe(false);
    expect(
      canChangeFamilyGroupRole('administrator', 'member', 'administrator'),
    ).toBe(false);
    expect(canChangeFamilyGroupRole('owner', 'member', 'administrator')).toBe(
      true,
    );
    expect(
      canChangeFamilyGroupRole('administrator', 'administrator', 'member'),
    ).toBe(true);
    expect(canChangeFamilyGroupRole('owner', 'owner', 'member')).toBe(false);
    expect(canChangeFamilyGroupRole('owner', 'member', 'owner')).toBe(false);
    expect(canRemoveFamilyGroupMember('owner', 'owner')).toBe(false);
    expect(canRemoveFamilyGroupMember('administrator', 'administrator')).toBe(
      true,
    );
  });
});
