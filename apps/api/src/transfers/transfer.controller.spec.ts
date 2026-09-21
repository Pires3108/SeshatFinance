import type { CreateTransferUseCase } from '@seshat/application';
import { Currency, Money, Transfer } from '@seshat/domain';
import type { FastifyRequest } from 'fastify';
import { describe, expect, it, vi } from 'vitest';

import { AuthenticatedActorContext } from '../auth/authenticated-actor-context.js';
import { TransferController } from './transfer.controller.js';

function request(actors: AuthenticatedActorContext): FastifyRequest {
  const value = {} as FastifyRequest;
  actors.set(value, { id: 'actor-id' });
  return value;
}

function transfer(): Transfer {
  return Transfer.create({
    amount: Money.fromDecimal('15.50', Currency.create('BRL', 2)),
    createdAt: new Date('2026-09-21T12:00:00.000Z'),
    description: 'Reserva',
    destinationAccountId: 'cb9c8549-404a-4fce-a434-09b65538eb86',
    destinationTransactionId: '2fa93982-b631-4cb6-9eca-95ecbad87308',
    id: 'c722103a-e28a-482c-b6e9-e3320d8a44e3',
    observations: null,
    occurredAt: new Date('2026-09-21T11:00:00.000Z'),
    ownerId: 'actor-id',
    sourceAccountId: '7c2c7a54-73fe-49a3-b0ea-19034bf22baf',
    sourceTransactionId: '86684068-45d9-4e14-b454-f7e556b867e7',
  });
}

describe('TransferController', () => {
  it('derives ownership from the verified actor and maps the linked pair', async () => {
    const actors = new AuthenticatedActorContext();
    const execute = vi.fn().mockResolvedValue(transfer());
    const controller = new TransferController(
      { execute } as unknown as CreateTransferUseCase,
      actors,
    );

    const response = await controller.create(request(actors), {
      amount: '15.50',
      currencyCode: 'BRL',
      currencyMinorUnitScale: 2,
      description: 'Reserva',
      destinationAccountId: 'cb9c8549-404a-4fce-a434-09b65538eb86',
      observations: null,
      occurredAt: '2026-09-21T11:00:00.000Z',
      sourceAccountId: '7c2c7a54-73fe-49a3-b0ea-19034bf22baf',
    });

    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({ actorId: 'actor-id' }),
    );
    expect(response).toMatchObject({
      amount: '15.50',
      destinationTransactionId: '2fa93982-b631-4cb6-9eca-95ecbad87308',
      sourceTransactionId: '86684068-45d9-4e14-b454-f7e556b867e7',
    });
    expect(response).not.toHaveProperty('ownerId');
  });
});
