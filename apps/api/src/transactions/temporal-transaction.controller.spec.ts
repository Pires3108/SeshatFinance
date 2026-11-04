import type { ListTemporalTransactionsUseCase } from '@seshat/application';
import { UnauthorizedException } from '@nestjs/common';
import { Currency, Money, Transaction } from '@seshat/domain';
import type { FastifyRequest } from 'fastify';
import { describe, expect, it, vi } from 'vitest';

import { AuthenticatedActorContext } from '../auth/authenticated-actor-context.js';
import { TemporalTransactionController } from './temporal-transaction.controller.js';

describe('TemporalTransactionController', () => {
  it('uses the authenticated principal and maps exact money and period boundaries', async () => {
    const actors = new AuthenticatedActorContext();
    const request = {} as FastifyRequest;
    actors.set(request, { id: 'verified-owner' });
    const transaction = Transaction.create({
      accountId: '7c2c7a54-73fe-49a3-b0ea-19034bf22baf',
      amount: Money.fromDecimal('10.25', Currency.create('BRL', 2)),
      createdAt: new Date('2026-11-02T12:00:00Z'),
      description: null,
      id: '86684068-45d9-4e14-b454-f7e556b867e7',
      kind: 'income',
      occurredAt: new Date('2026-11-02T12:00:00Z'),
      ownerId: 'verified-owner',
    });
    const total = {
      currencyCode: 'BRL',
      currencyMinorUnitScale: 2,
      income: '10.25',
      expense: '0.00',
    };
    const execute = vi.fn().mockResolvedValue({
      period: 'day',
      selectedDate: '2026-11-02',
      timeZone: 'America/Sao_Paulo',
      from: new Date('2026-11-02T03:00:00Z'),
      to: new Date('2026-11-03T03:00:00Z'),
      days: [
        { date: '2026-11-02', transactions: [transaction], totals: [total] },
      ],
      totals: [total],
    });
    const controller = new TemporalTransactionController(
      { execute } as unknown as ListTemporalTransactionsUseCase,
      actors,
    );
    const response = await controller.list(request, {
      period: 'day',
      date: '2026-11-02',
    });
    expect(execute).toHaveBeenCalledWith('verified-owner', 'day', '2026-11-02');
    expect(response.from).toBe('2026-11-02T03:00:00.000Z');
    expect(response.days[0]?.transactions[0]?.amount).toBe('10.25');
    expect(response.totals).toEqual([total]);
  });

  it('rejects a request without an authenticated actor', async () => {
    const execute = vi.fn();
    const controller = new TemporalTransactionController(
      { execute } as unknown as ListTemporalTransactionsUseCase,
      new AuthenticatedActorContext(),
    );
    await expect(
      controller.list({} as FastifyRequest, {
        period: 'week',
        date: '2026-11-02',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(execute).not.toHaveBeenCalled();
  });
});
