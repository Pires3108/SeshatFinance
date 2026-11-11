import type { FamilyGroupRepository } from './create-family-group.js';
import {
  ChangeFamilyGroupRoleUseCase,
  CreateFamilyGroupUseCase,
} from './create-family-group.js';

import { describe, expect, it, vi } from 'vitest';

import type { Clock } from '../ports/clock.js';
import type { IdentifierGenerator } from '../ports/identifier-generator.js';

describe('CreateFamilyGroupUseCase', () => {
  it('persists a group together with the authenticated actor as owner', async () => {
    const insert = vi.fn().mockResolvedValue(undefined);
    const useCase = new CreateFamilyGroupUseCase(
      {
        insert,
        listForMember: vi.fn(),
        changeRole: vi.fn(),
      } satisfies FamilyGroupRepository,
      { now: (): Date => new Date('2026-09-24T12:00:00.000Z') } satisfies Clock,
      { generate: (): string => 'group-id' } satisfies IdentifierGenerator,
    );

    const membership = await useCase.execute('actor-id');

    expect(membership.toSnapshot()).toMatchObject({
      groupId: 'group-id',
      role: 'owner',
      userId: 'actor-id',
    });
    expect(insert).toHaveBeenCalledTimes(1);
  });
});

describe('ChangeFamilyGroupRoleUseCase', () => {
  it('passes verified actor and injected audit metadata to the repository', async () => {
    const changeRole = vi.fn().mockResolvedValue('member');
    const useCase = new ChangeFamilyGroupRoleUseCase(
      { insert: vi.fn(), listForMember: vi.fn(), changeRole },
      { now: (): Date => new Date('2026-09-30T14:00:00.000Z') },
      { generate: (): string => 'audit-event-id' },
    );

    await expect(
      useCase.execute({
        actorId: 'actor-id',
        groupId: 'group-id',
        targetUserId: 'target-id',
        nextRole: 'member',
      }),
    ).resolves.toBe('member');
    expect(changeRole).toHaveBeenCalledWith({
      actorId: 'actor-id',
      changedAt: new Date('2026-09-30T14:00:00.000Z'),
      eventId: 'audit-event-id',
      groupId: 'group-id',
      nextRole: 'member',
      targetUserId: 'target-id',
    });
  });
});
