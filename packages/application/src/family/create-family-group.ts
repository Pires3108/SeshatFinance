import {
  FamilyGroup,
  FamilyGroupMembership,
  type FamilyGroupMembershipSnapshot,
} from '@seshat/domain';

import type { Clock } from '../ports/clock.js';
import type { IdentifierGenerator } from '../ports/identifier-generator.js';

export interface FamilyGroupRepository {
  insert(
    group: FamilyGroup,
    ownerMembership: FamilyGroupMembership,
  ): Promise<void>;
  listForMember(
    userId: string,
  ): Promise<readonly FamilyGroupMembershipSnapshot[]>;
}

export class CreateFamilyGroupUseCase {
  public constructor(
    private readonly groups: FamilyGroupRepository,
    private readonly clock: Clock,
    private readonly identifiers: IdentifierGenerator,
  ) {}

  public async execute(actorId: string): Promise<FamilyGroupMembership> {
    const at = this.clock.now();
    const group = FamilyGroup.create({
      createdAt: at,
      id: this.identifiers.generate(),
    });
    const ownerMembership = FamilyGroupMembership.createOwner({
      groupId: group.id,
      joinedAt: at,
      userId: actorId,
    });
    await this.groups.insert(group, ownerMembership);
    return ownerMembership;
  }
}

export class ListOwnFamilyGroupsUseCase {
  public constructor(private readonly groups: FamilyGroupRepository) {}

  public execute(
    userId: string,
  ): Promise<readonly FamilyGroupMembershipSnapshot[]> {
    return this.groups.listForMember(userId);
  }
}
