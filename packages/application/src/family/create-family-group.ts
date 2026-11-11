import {
  FamilyGroup,
  FamilyGroupMembership,
  type FamilyGroupMembershipSnapshot,
  type FamilyGroupRole,
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
  changeRole(command: ChangeFamilyGroupRoleCommand): Promise<FamilyGroupRole>;
}

export type ChangeFamilyGroupRoleCommand = Readonly<{
  actorId: string;
  changedAt: Date;
  eventId: string;
  groupId: string;
  nextRole: Exclude<FamilyGroupRole, 'owner'>;
  targetUserId: string;
}>;

export class FamilyGroupRoleChangeDeniedError extends Error {
  public constructor() {
    super('Family group role change is not allowed.');
    this.name = 'FamilyGroupRoleChangeDeniedError';
  }
}

export class ChangeFamilyGroupRoleUseCase {
  public constructor(
    private readonly groups: FamilyGroupRepository,
    private readonly clock: Clock,
    private readonly identifiers: IdentifierGenerator,
  ) {}

  public execute(
    command: Omit<ChangeFamilyGroupRoleCommand, 'changedAt' | 'eventId'>,
  ): Promise<FamilyGroupRole> {
    return this.groups.changeRole({
      ...command,
      changedAt: this.clock.now(),
      eventId: this.identifiers.generate(),
    });
  }
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
