import { describe, expect, it } from 'vitest';
import {
  AcceptFamilyGroupInvitationUseCase,
  CreateFamilyGroupInvitationUseCase,
  type FamilyGroupInvitationRepository,
} from './manage-family-group-invitation.js';
import type { FamilyGroupInvitationSnapshot } from '@seshat/domain';

const clock = { now: () => new Date('2026-10-07T12:00:00.000Z') };
const identifiers = { generate: () => '11111111-1111-4111-8111-111111111111' };
const tokens = { generate: () => ({ token: 'secret', hash: 'hash' }) };

describe('family group invitations', () => {
  it('creates a normalized single use invitation expiring in 72 hours', async () => {
    let created!: FamilyGroupInvitationSnapshot;
    const repository: FamilyGroupInvitationRepository = {
      create: (value) => {
        created = value.toSnapshot();
        return Promise.resolve();
      },
      revoke: () => Promise.resolve(),
      accept: () => Promise.resolve(created),
    };
    const result = await new CreateFamilyGroupInvitationUseCase(
      repository,
      clock,
      identifiers,
      tokens,
    ).execute({
      actorId: 'owner',
      groupId: 'group',
      email: ' Person@Example.COM ',
      role: 'member',
    });
    expect(result.token).toBe('secret');
    expect(created.email).toBe('person@example.com');
    expect(created.expiresAt.toISOString()).toBe('2026-10-10T12:00:00.000Z');
  });

  it('passes only confirmed identity email to the atomic acceptance port', async () => {
    let received!: { confirmedEmail: string };
    const repository: FamilyGroupInvitationRepository = {
      create: () => Promise.resolve(),
      revoke: () => Promise.resolve(),
      accept: (command) => {
        received = command;
        return Promise.resolve({} as FamilyGroupInvitationSnapshot);
      },
    };
    await new AcceptFamilyGroupInvitationUseCase(repository, clock).execute({
      tokenHash: 'hash',
      userId: 'user',
      confirmedEmail: 'PERSON@example.com',
    });
    expect(received.confirmedEmail).toBe('PERSON@example.com');
  });
});
