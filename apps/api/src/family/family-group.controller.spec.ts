import type {
  CreateFamilyGroupUseCase,
  ListOwnFamilyGroupsUseCase,
} from '@seshat/application';
import { FamilyGroupMembership } from '@seshat/domain';
import type { FastifyRequest } from 'fastify';
import { describe, expect, it, vi } from 'vitest';

import { AuthenticatedActorContext } from '../auth/authenticated-actor-context.js';
import { FamilyGroupController } from './family-group.controller.js';

function request(actors: AuthenticatedActorContext): FastifyRequest {
  const value = {} as FastifyRequest;
  actors.set(value, { id: 'actor-id' });
  return value;
}

describe('FamilyGroupController', () => {
  it('derives owner membership from the verified actor', async () => {
    const actors = new AuthenticatedActorContext();
    const execute = vi.fn().mockResolvedValue(
      FamilyGroupMembership.createOwner({
        groupId: '7c2c7a54-73fe-49a3-b0ea-19034bf22baf',
        joinedAt: new Date('2026-09-24T12:00:00.000Z'),
        userId: 'actor-id',
      }),
    );
    const controller = new FamilyGroupController(
      { execute } as unknown as CreateFamilyGroupUseCase,
      { execute: vi.fn() } as unknown as ListOwnFamilyGroupsUseCase,
      actors,
    );

    const response = await controller.create(request(actors));

    expect(execute).toHaveBeenCalledWith('actor-id');
    expect(response).toEqual({
      groupId: '7c2c7a54-73fe-49a3-b0ea-19034bf22baf',
      joinedAt: '2026-09-24T12:00:00.000Z',
      role: 'owner',
    });
  });
});
