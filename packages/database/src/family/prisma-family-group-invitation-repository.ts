import type { FamilyGroupInvitationRepository } from '@seshat/application';
import {
  InvalidFamilyGroupInvitationError,
  type FamilyGroupInvitation,
  type FamilyGroupRole,
} from '@seshat/domain';
import type { PrismaClient } from '../generated/prisma/client.js';

export class PrismaFamilyGroupInvitationRepository implements FamilyGroupInvitationRepository {
  public constructor(private readonly client: PrismaClient) {}
  public async create(invitation: FamilyGroupInvitation): Promise<void> {
    const value = invitation.toSnapshot();
    await this.client.familyGroupInvitation.create({
      data: {
        id: value.id,
        groupId: value.groupId,
        invitedBy: value.invitedBy,
        email: value.email,
        role: value.role,
        tokenHash: value.tokenHash,
        createdAt: value.createdAt,
        expiresAt: value.expiresAt,
        status: value.status,
      },
    });
  }
  public async revoke(command: {
    invitationId: string;
    actorId: string;
  }): Promise<void> {
    await this.client.familyGroupInvitation.updateMany({
      where: {
        id: command.invitationId,
        invitedBy: command.actorId,
        status: 'pending',
      },
      data: { status: 'revoked' },
    });
  }
  public async accept(command: {
    tokenHash: string;
    userId: string;
    confirmedEmail: string;
    acceptedAt: Date;
  }): Promise<import('@seshat/domain').FamilyGroupInvitationSnapshot> {
    const email = command.confirmedEmail.trim().toLowerCase();
    return this.client.$transaction(async (client) => {
      const rows = await client.$queryRaw<readonly { id: string }[]>`
        SELECT "id" FROM "family_group_invitations" WHERE "token_hash" = ${command.tokenHash}
        AND "status" = 'pending'::"family_group_invitation_status" AND "expires_at" > ${command.acceptedAt} FOR UPDATE`;
      if (rows.length === 0)
        throw new InvalidFamilyGroupInvitationError(
          'Invitation is unavailable.',
        );
      const invitation = await client.familyGroupInvitation.findUniqueOrThrow({
        where: { id: rows[0]!.id },
      });
      if (invitation.email !== email)
        throw new InvalidFamilyGroupInvitationError(
          'Confirmed email does not match invitation.',
        );
      await client.familyGroupMembership.upsert({
        where: {
          groupId_userId: {
            groupId: invitation.groupId,
            userId: command.userId,
          },
        },
        create: {
          groupId: invitation.groupId,
          userId: command.userId,
          role: invitation.role,
          joinedAt: command.acceptedAt,
        },
        update: {},
      });
      const updated = await client.familyGroupInvitation.update({
        where: { id: invitation.id },
        data: {
          status: 'accepted',
          acceptedAt: command.acceptedAt,
          acceptedUserId: command.userId,
        },
      });
      const result = {
        id: updated.id,
        groupId: updated.groupId,
        invitedBy: updated.invitedBy,
        email: updated.email,
        role: updated.role as Exclude<FamilyGroupRole, 'owner'>,
        tokenHash: updated.tokenHash,
        createdAt: updated.createdAt,
        expiresAt: updated.expiresAt,
        status: updated.status,
      };
      return updated.acceptedAt
        ? {
            ...result,
            acceptedAt: updated.acceptedAt,
            ...(updated.acceptedUserId
              ? { acceptedUserId: updated.acceptedUserId }
              : {}),
          }
        : result;
    });
  }
}
