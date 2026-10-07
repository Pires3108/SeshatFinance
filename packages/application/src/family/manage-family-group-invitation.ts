import {
  FamilyGroupInvitation,
  type FamilyGroupInvitationSnapshot,
  type FamilyGroupRole,
} from '@seshat/domain';
import type { Clock } from '../ports/clock.js';
import type { IdentifierGenerator } from '../ports/identifier-generator.js';

export interface FamilyGroupInvitationRepository {
  create(invitation: FamilyGroupInvitation): Promise<void>;
  revoke(command: { invitationId: string; actorId: string }): Promise<void>;
  accept(command: {
    tokenHash: string;
    userId: string;
    confirmedEmail: string;
    acceptedAt: Date;
  }): Promise<FamilyGroupInvitationSnapshot>;
}

export interface InvitationTokenGenerator {
  generate(): { token: string; hash: string };
}

export class CreateFamilyGroupInvitationUseCase {
  public constructor(
    private readonly invitations: FamilyGroupInvitationRepository,
    private readonly clock: Clock,
    private readonly identifiers: IdentifierGenerator,
    private readonly tokens: InvitationTokenGenerator,
  ) {}

  public async execute(command: {
    actorId: string;
    groupId: string;
    email: string;
    role: Exclude<FamilyGroupRole, 'owner'>;
  }): Promise<{ invitation: FamilyGroupInvitationSnapshot; token: string }> {
    const createdAt = this.clock.now();
    const token = this.tokens.generate();
    const invitation = FamilyGroupInvitation.create({
      id: this.identifiers.generate(),
      groupId: command.groupId,
      invitedBy: command.actorId,
      email: command.email,
      role: command.role,
      tokenHash: token.hash,
      createdAt,
      expiresAt: new Date(createdAt.getTime() + 72 * 60 * 60 * 1000),
      status: 'pending',
    });
    await this.invitations.create(invitation);
    return { invitation: invitation.toSnapshot(), token: token.token };
  }
}

export class AcceptFamilyGroupInvitationUseCase {
  public constructor(
    private readonly invitations: FamilyGroupInvitationRepository,
    private readonly clock: Clock,
  ) {}

  public execute(command: {
    tokenHash: string;
    userId: string;
    confirmedEmail: string;
  }): Promise<FamilyGroupInvitationSnapshot> {
    return this.invitations.accept({
      ...command,
      acceptedAt: this.clock.now(),
    });
  }
}

export class RevokeFamilyGroupInvitationUseCase {
  public constructor(
    private readonly invitations: FamilyGroupInvitationRepository,
  ) {}

  public execute(invitationId: string, actorId: string): Promise<void> {
    return this.invitations.revoke({ invitationId, actorId });
  }
}
