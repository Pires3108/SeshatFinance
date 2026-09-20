import type {
  CreateTagUseCase,
  ListOwnedTagsUseCase,
  RenameOwnedTagUseCase,
} from '@seshat/application';
import { Tag } from '@seshat/domain';
import type { FastifyRequest } from 'fastify';
import { describe, expect, it, vi } from 'vitest';

import { AuthenticatedActorContext } from '../auth/authenticated-actor-context.js';
import { TagController } from './tag.controller.js';

function request(actors: AuthenticatedActorContext): FastifyRequest {
  const value = {} as FastifyRequest;
  actors.set(value, { id: 'actor-id' });
  return value;
}

function tag(): Tag {
  return Tag.create({
    createdAt: new Date('2026-09-20T12:00:00.000Z'),
    id: '7c2c7a54-73fe-49a3-b0ea-19034bf22baf',
    name: 'Essencial',
    ownerId: 'actor-id',
  });
}

describe('TagController', () => {
  it('creates tags for the verified actor', async () => {
    const actors = new AuthenticatedActorContext();
    const execute = vi.fn().mockResolvedValue(tag());
    const controller = new TagController(
      { execute } as unknown as CreateTagUseCase,
      { execute: vi.fn() } as unknown as ListOwnedTagsUseCase,
      { execute: vi.fn() } as unknown as RenameOwnedTagUseCase,
      actors,
    );

    await controller.create(request(actors), { name: 'Essencial' });

    expect(execute).toHaveBeenCalledWith({
      actorId: 'actor-id',
      name: 'Essencial',
    });
  });

  it('lists tags only for the verified actor', async () => {
    const actors = new AuthenticatedActorContext();
    const execute = vi.fn().mockResolvedValue([tag()]);
    const controller = new TagController(
      { execute: vi.fn() } as unknown as CreateTagUseCase,
      { execute } as unknown as ListOwnedTagsUseCase,
      { execute: vi.fn() } as unknown as RenameOwnedTagUseCase,
      actors,
    );

    const result = await controller.list(request(actors));

    expect(execute).toHaveBeenCalledWith('actor-id');
    expect(result).toHaveLength(1);
  });
});
