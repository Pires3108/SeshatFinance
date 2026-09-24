import type { FamilyGroupRepository } from '@seshat/application';
import type {
  FamilyGroup,
  FamilyGroupMembership,
  FamilyGroupMembershipSnapshot,
} from '@seshat/domain';
import { PrismaFamilyGroupRepository } from '@seshat/database';
import { Injectable } from '@nestjs/common';

import { LazyPrismaClient } from '../platform/lazy-prisma-client.js';

@Injectable()
export class LazyFamilyGroupRepository implements FamilyGroupRepository {
  private repository: PrismaFamilyGroupRepository | undefined;

  public constructor(private readonly prisma: LazyPrismaClient) {}

  public insert(
    group: FamilyGroup,
    ownerMembership: FamilyGroupMembership,
  ): Promise<void> {
    return this.getRepository().insert(group, ownerMembership);
  }

  public listForMember(
    userId: string,
  ): Promise<readonly FamilyGroupMembershipSnapshot[]> {
    return this.getRepository().listForMember(userId);
  }

  private getRepository(): PrismaFamilyGroupRepository {
    this.repository ??= new PrismaFamilyGroupRepository(this.prisma.get());
    return this.repository;
  }
}
