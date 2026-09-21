import type {
  GetOwnedTransactionClassificationUseCase,
  SetOwnedTransactionClassificationUseCase,
} from '@seshat/application';
import type { FastifyRequest } from 'fastify';
import { describe, expect, it, vi } from 'vitest';

import { AuthenticatedActorContext } from '../auth/authenticated-actor-context.js';
import { TransactionClassificationController } from './transaction-classification.controller.js';

const transactionId = '86684068-45d9-4e14-b454-f7e556b867e7';
const selection = {
  categoryId: '2e1fe3e4-cf56-460d-bb9f-b21c318ff93e',
  costCenterId: null,
  subcategoryId: null,
};

function request(actors: AuthenticatedActorContext): FastifyRequest {
  const value = {} as FastifyRequest;
  actors.set(value, { id: 'actor-id' });
  return value;
}

describe('TransactionClassificationController', () => {
  it('gets a classification using the verified actor', async () => {
    const actors = new AuthenticatedActorContext();
    const execute = vi.fn().mockResolvedValue(selection);
    const controller = new TransactionClassificationController(
      { execute } as unknown as GetOwnedTransactionClassificationUseCase,
      {
        execute: vi.fn(),
      } as unknown as SetOwnedTransactionClassificationUseCase,
      actors,
    );

    await expect(
      controller.get(request(actors), transactionId),
    ).resolves.toEqual(selection);
    expect(execute).toHaveBeenCalledWith(transactionId, 'actor-id');
  });

  it('replaces a classification using only the verified actor', async () => {
    const actors = new AuthenticatedActorContext();
    const execute = vi.fn().mockResolvedValue(selection);
    const controller = new TransactionClassificationController(
      {
        execute: vi.fn(),
      } as unknown as GetOwnedTransactionClassificationUseCase,
      { execute } as unknown as SetOwnedTransactionClassificationUseCase,
      actors,
    );

    await expect(
      controller.replace(request(actors), transactionId, selection),
    ).resolves.toEqual(selection);
    expect(execute).toHaveBeenCalledWith({
      actorId: 'actor-id',
      ...selection,
      transactionId,
    });
  });
});
