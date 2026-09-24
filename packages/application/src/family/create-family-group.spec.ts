import type { FamilyGroupRepository } from './create-family-group.js';
import { CreateFamilyGroupUseCase } from './create-family-group.js';

import { describe, expect, it, vi } from 'vitest';

import type { Clock } from '../ports/clock.js';
import type { IdentifierGenerator } from '../ports/identifier-generator.js';

describe('CreateFamilyGroupUseCase', () => {
  it('persists a group together with the authenticated actor as owner', async () => {
    const insert = vi.fn().mockResolvedValue(undefined);
    const useCase = new CreateFamilyGroupUseCase(
      { insert, listForMember: vi.fn() } as unknown as FamilyGroupRepository,
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
