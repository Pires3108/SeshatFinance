import type {
  GetOwnUserProfileUseCase,
  UpdateOwnUserProfileUseCase,
  UserProfile,
} from '@seshat/application';
import { NotFoundException } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { describe, expect, it, vi } from 'vitest';

import { AuthenticatedActorContext } from '../auth/authenticated-actor-context.js';
import { UserProfileController } from './user-profile.controller.js';

const profile: UserProfile = {
  createdAt: new Date('2026-09-20T12:00:00.000Z'),
  displayName: 'Nicolas',
  id: 'actor-id',
  locale: 'pt-BR',
  presentationCurrency: 'BRL',
  timeZone: 'America/Sao_Paulo',
  updatedAt: new Date('2026-09-20T12:00:00.000Z'),
  version: 1,
};

function requestWithActor(actors: AuthenticatedActorContext): FastifyRequest {
  const request = {} as FastifyRequest;
  actors.set(request, { id: 'actor-id' });
  return request;
}

describe('UserProfileController', () => {
  it('updates only the profile selected by the verified actor', async (): Promise<void> => {
    const actors = new AuthenticatedActorContext();
    const executeUpdate = vi.fn().mockResolvedValue(profile);
    const controller = new UserProfileController(
      { execute: vi.fn() } as unknown as GetOwnUserProfileUseCase,
      { execute: executeUpdate } as unknown as UpdateOwnUserProfileUseCase,
      actors,
    );

    await controller.update(requestWithActor(actors), {
      displayName: 'Nicolas',
      locale: 'pt-BR',
      presentationCurrency: 'BRL',
      timeZone: 'America/Sao_Paulo',
    });

    expect(executeUpdate).toHaveBeenCalledWith({
      actorId: 'actor-id',
      displayName: 'Nicolas',
      locale: 'pt-BR',
      presentationCurrency: 'BRL',
      timeZone: 'America/Sao_Paulo',
    });
  });

  it('returns not found instead of creating defaults during a read', async (): Promise<void> => {
    const actors = new AuthenticatedActorContext();
    const controller = new UserProfileController(
      {
        execute: vi.fn().mockResolvedValue(null),
      } as unknown as GetOwnUserProfileUseCase,
      { execute: vi.fn() } as unknown as UpdateOwnUserProfileUseCase,
      actors,
    );

    await expect(
      controller.get(requestWithActor(actors)),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
