import type {
  CreateCategoryUseCase,
  ListOwnedCategoriesUseCase,
  RenameOwnedCategoryUseCase,
} from '@seshat/application';
import { Category } from '@seshat/domain';
import type { FastifyRequest } from 'fastify';
import { describe, expect, it, vi } from 'vitest';

import { AuthenticatedActorContext } from '../auth/authenticated-actor-context.js';
import { CategoryController } from './category.controller.js';

function request(actors: AuthenticatedActorContext): FastifyRequest {
  const value = {} as FastifyRequest;
  actors.set(value, { id: 'actor-id' });
  return value;
}

function category(): Category {
  return Category.create({
    createdAt: new Date('2026-09-20T12:00:00.000Z'),
    id: '7c2c7a54-73fe-49a3-b0ea-19034bf22baf',
    name: 'Alimentação',
    ownerId: 'actor-id',
    parentCategoryId: null,
  });
}

describe('CategoryController', () => {
  it('creates categories for the verified actor', async () => {
    const actors = new AuthenticatedActorContext();
    const execute = vi.fn().mockResolvedValue(category());
    const controller = new CategoryController(
      { execute } as unknown as CreateCategoryUseCase,
      { execute: vi.fn() } as unknown as ListOwnedCategoriesUseCase,
      { execute: vi.fn() } as unknown as RenameOwnedCategoryUseCase,
      actors,
    );

    await controller.create(request(actors), {
      name: 'Alimentação',
      parentCategoryId: null,
    });

    expect(execute).toHaveBeenCalledWith({
      actorId: 'actor-id',
      name: 'Alimentação',
      parentCategoryId: null,
    });
  });

  it('lists categories only for the verified actor', async () => {
    const actors = new AuthenticatedActorContext();
    const execute = vi.fn().mockResolvedValue([category()]);
    const controller = new CategoryController(
      { execute: vi.fn() } as unknown as CreateCategoryUseCase,
      { execute } as unknown as ListOwnedCategoriesUseCase,
      { execute: vi.fn() } as unknown as RenameOwnedCategoryUseCase,
      actors,
    );

    const result = await controller.list(request(actors));

    expect(execute).toHaveBeenCalledWith('actor-id');
    expect(result).toHaveLength(1);
  });
});
