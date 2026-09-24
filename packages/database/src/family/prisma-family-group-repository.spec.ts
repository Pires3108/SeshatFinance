import { FamilyGroup, FamilyGroupMembership } from '@seshat/domain';
import { describe, expect, it, vi } from 'vitest';

import { PrismaFamilyGroupRepository } from './prisma-family-group-repository.js';

describe('PrismaFamilyGroupRepository', () => {
  it('rejects an initial membership that is not the group owner', async () => {
    const create = vi.fn();
    const repository = new PrismaFamilyGroupRepository({
      familyGroup: { create },
    } as never);
    const group = FamilyGroup.create({
      createdAt: new Date('2026-09-24T12:00:00.000Z'),
      id: 'group-id',
    });
    const member = FamilyGroupMembership.create({
      groupId: group.id,
      joinedAt: new Date('2026-09-24T12:00:00.000Z'),
      role: 'member',
      userId: 'user-id',
    });

    await expect(repository.insert(group, member)).rejects.toThrow(
      'matching owner membership',
    );
    expect(create).not.toHaveBeenCalled();
  });
});
