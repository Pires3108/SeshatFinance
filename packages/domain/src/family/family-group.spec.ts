import { describe, expect, it } from 'vitest';

import { FamilyGroup, FamilyGroupMembership } from './family-group.js';
import { hasFamilyGroupCapability } from './family-group-policy.js';

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
});
