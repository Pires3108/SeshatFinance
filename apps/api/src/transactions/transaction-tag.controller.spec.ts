import type {
  ListOwnedTransactionTagsUseCase,
  SetOwnedTransactionTagsUseCase,
} from '@seshat/application';
import type { FastifyRequest } from 'fastify';
import { describe, expect, it, vi } from 'vitest';

import { AuthenticatedActorContext } from '../auth/authenticated-actor-context.js';
import { TransactionTagController } from './transaction-tag.controller.js';

const transactionId = '86684068-45d9-4e14-b454-f7e556b867e7';
const tagId = '2e1fe3e4-cf56-460d-bb9f-b21c318ff93e';

function request(actors: AuthenticatedActorContext): FastifyRequest {
  const value = {} as FastifyRequest;
  actors.set(value, { id: 'actor-id' });
  return value;
}

describe('TransactionTagController', () => {
  it('lists assignments using the verified actor', async () => {
    const actors = new AuthenticatedActorContext();
    const execute = vi.fn().mockResolvedValue([tagId]);
    const controller = new TransactionTagController(
      { execute } as unknown as ListOwnedTransactionTagsUseCase,
      { execute: vi.fn() } as unknown as SetOwnedTransactionTagsUseCase,
      actors,
    );

    await expect(
      controller.list(request(actors), transactionId),
    ).resolves.toEqual({
      tagIds: [tagId],
    });
    expect(execute).toHaveBeenCalledWith(transactionId, 'actor-id');
  });

  it('replaces assignments using only the verified actor', async () => {
    const actors = new AuthenticatedActorContext();
    const execute = vi.fn().mockResolvedValue([tagId]);
    const controller = new TransactionTagController(
      { execute: vi.fn() } as unknown as ListOwnedTransactionTagsUseCase,
      { execute } as unknown as SetOwnedTransactionTagsUseCase,
      actors,
    );

    await expect(
      controller.replace(request(actors), transactionId, { tagIds: [tagId] }),
    ).resolves.toEqual({ tagIds: [tagId] });
    expect(execute).toHaveBeenCalledWith({
      actorId: 'actor-id',
      tagIds: [tagId],
      transactionId,
    });
  });
});
