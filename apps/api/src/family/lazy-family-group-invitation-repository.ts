import type { FamilyGroupInvitationRepository } from '@seshat/application';
import { PrismaFamilyGroupInvitationRepository } from '@seshat/database';
import { Injectable } from '@nestjs/common';
import { LazyPrismaClient } from '../platform/lazy-prisma-client.js';

@Injectable()
export class LazyFamilyGroupInvitationRepository implements FamilyGroupInvitationRepository {
  private repository: PrismaFamilyGroupInvitationRepository | undefined;
  public constructor(private readonly prisma: LazyPrismaClient) {}
  public create(
    invitation: import('@seshat/domain').FamilyGroupInvitation,
  ): Promise<void> {
    return this.getRepository().create(invitation);
  }
  public revoke(command: {
    invitationId: string;
    actorId: string;
  }): Promise<void> {
    return this.getRepository().revoke(command);
  }
  public accept(command: {
    tokenHash: string;
    userId: string;
    confirmedEmail: string;
    acceptedAt: Date;
  }): Promise<import('@seshat/domain').FamilyGroupInvitationSnapshot> {
    return this.getRepository().accept(command);
  }
  private getRepository(): PrismaFamilyGroupInvitationRepository {
    this.repository ??= new PrismaFamilyGroupInvitationRepository(
      this.prisma.get(),
    );
    return this.repository;
  }
}
