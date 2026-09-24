import type { FamilyGroupRepository } from '@seshat/application';
import {
  FamilyGroup,
  FamilyGroupMembership,
  type FamilyGroupMembershipSnapshot,
} from '@seshat/domain';

import type { PrismaClient } from '../generated/prisma/client.js';

export class PrismaFamilyGroupRepository implements FamilyGroupRepository {
  public constructor(private readonly client: PrismaClient) {}

  public async insert(
    group: FamilyGroup,
    ownerMembership: FamilyGroupMembership,
  ): Promise<void> {
    const owner = ownerMembership.toSnapshot();
    if (owner.groupId !== group.id || owner.role !== 'owner') {
      throw new Error(
        'A family group must be created with its matching owner membership.',
      );
    }
    await this.client.familyGroup.create({
      data: {
        createdAt: group.toSnapshot().createdAt,
        id: group.id,
        members: {
          create: {
            joinedAt: owner.joinedAt,
            role: owner.role,
            userId: owner.userId,
          },
        },
      },
    });
  }

  public async listForMember(
    userId: string,
  ): Promise<readonly FamilyGroupMembershipSnapshot[]> {
    const memberships = await this.client.familyGroupMembership.findMany({
      orderBy: [{ joinedAt: 'asc' }, { groupId: 'asc' }],
      where: { userId },
    });
    return memberships.map((membership) => ({
      groupId: membership.groupId,
      joinedAt: membership.joinedAt,
      role: membership.role,
      userId: membership.userId,
    }));
  }
}
