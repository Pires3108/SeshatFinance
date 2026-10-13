import {
  FamilyGroupRoleChangeDeniedError,
  type ChangeFamilyGroupRoleCommand,
  type FamilyGroupRepository,
} from '@seshat/application';
import type {
  FamilyGroup,
  FamilyGroupMembership,
  FamilyGroupMembershipSnapshot,
  FamilyGroupRole,
} from '@seshat/domain';
import { canChangeFamilyGroupRole } from '@seshat/domain';

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

  public async changeRole(
    command: ChangeFamilyGroupRoleCommand,
  ): Promise<FamilyGroupRole> {
    return this.client.$transaction(async (client) => {
      const groups = await client.$queryRaw<readonly { id: string }[]>`
        SELECT "id" FROM "family_groups"
        WHERE "id" = ${command.groupId}::uuid FOR UPDATE
      `;
      if (groups.length === 0) throw new FamilyGroupRoleChangeDeniedError();

      const [actor, target] = await Promise.all([
        client.familyGroupMembership.findUnique({
          where: {
            groupId_userId: {
              groupId: command.groupId,
              userId: command.actorId,
            },
          },
        }),
        client.familyGroupMembership.findUnique({
          where: {
            groupId_userId: {
              groupId: command.groupId,
              userId: command.targetUserId,
            },
          },
        }),
      ]);
      if (
        actor === null ||
        target === null ||
        !canChangeFamilyGroupRole(actor.role, target.role, command.nextRole)
      ) {
        throw new FamilyGroupRoleChangeDeniedError();
      }
      if (target.role === command.nextRole) return target.role;

      await client.familyGroupMembership.update({
        where: {
          groupId_userId: {
            groupId: command.groupId,
            userId: command.targetUserId,
          },
        },
        data: { role: command.nextRole },
      });
      await client.familyGroupRoleChange.create({
        data: {
          id: command.eventId,
          groupId: command.groupId,
          actorId: command.actorId,
          targetUserId: command.targetUserId,
          previousRole: target.role,
          nextRole: command.nextRole,
          changedAt: command.changedAt,
        },
      });
      return command.nextRole;
    });
  }
}
