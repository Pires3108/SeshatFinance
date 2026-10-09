import { Account, AccountType, Currency, Money } from '@seshat/domain';
import { describe, expect, it, vi } from 'vitest';

import type { GetOwnedAccountBalanceUseCase } from './get-account-balance.js';
import { GetOwnedBalanceSummaryUseCase } from './get-owned-balance-summary.js';

function account(id: string, currencyCode: string): Account {
  return Account.create({
    color: null,
    createdAt: new Date('2026-09-20T12:00:00.000Z'),
    description: null,
    icon: null,
    id,
    initialBalance: Money.fromDecimal('0.00', Currency.create(currencyCode, 2)),
    institution: null,
    name: id,
    ownerId: 'owner-id',
    type: AccountType.create('checking-account'),
  });
}

function useCase(
  accounts: readonly Account[],
  balances: Readonly<Record<string, Money>>,
): {
  execute: (
    actorId: string,
  ) => ReturnType<GetOwnedBalanceSummaryUseCase['execute']>;
  listForOwnedBalanceSummary: ReturnType<typeof vi.fn>;
} {
  const listForOwnedBalanceSummary = vi.fn().mockResolvedValue(accounts);
  const execute = vi.fn().mockImplementation((accountId: string) => {
    const balance = balances[accountId];
    if (balance === undefined) throw new Error('Missing balance fixture.');
    return Promise.resolve(balance);
  });
  const useCase = new GetOwnedBalanceSummaryUseCase(
    { listForOwnedBalanceSummary },
    { execute } as unknown as GetOwnedAccountBalanceUseCase,
  );
  return {
    execute: (actorId) => useCase.execute(actorId),
    listForOwnedBalanceSummary,
  };
}

describe('GetOwnedBalanceSummaryUseCase', () => {
  it('preserves exact amounts by currency and rejects implicit BRL conversion', async () => {
    const app = useCase(
      [
        account('brl-1', 'BRL'),
        account('usd-1', 'USD'),
        account('brl-2', 'BRL'),
      ],
      {
        'brl-1': Money.fromDecimal('10.25', Currency.create('BRL', 2)),
        'brl-2': Money.fromDecimal('0.10', Currency.create('BRL', 2)),
        'usd-1': Money.fromDecimal('12.40', Currency.create('USD', 2)),
      },
    );

    const summary = await app.execute('owner-id');

    expect(app.listForOwnedBalanceSummary).toHaveBeenCalledWith('owner-id');
    expect(
      summary.accountBalances.map(({ accountId, balance }) => [
        accountId,
        balance.toDecimal(),
      ]),
    ).toEqual([
      ['brl-1', '10.25'],
      ['usd-1', '12.40'],
      ['brl-2', '0.10'],
    ]);
    expect(
      summary.totalsByCurrency.map((total) => [
        total.currency.code,
        total.toDecimal(),
      ]),
    ).toEqual([
      ['BRL', '10.35'],
      ['USD', '12.40'],
    ]);
    expect(summary.brlConsolidation).toEqual({
      reason: 'conversion-policy-pending',
      status: 'unavailable',
    });
  });

  it('returns an exact BRL total when no conversion is needed', async () => {
    const app = useCase([account('brl-1', 'BRL')], {
      'brl-1': Money.fromDecimal('15.27', Currency.create('BRL', 2)),
    });

    const summary = await app.execute('owner-id');

    expect(summary.brlConsolidation.status).toBe('available');
    if (summary.brlConsolidation.status === 'available') {
      expect(summary.brlConsolidation.balance.toDecimal()).toBe('15.27');
    }
  });

  it('returns a zero BRL total for an empty account set', async () => {
    const summary = await useCase([], {}).execute('owner-id');

    expect(summary.brlConsolidation.status).toBe('available');
    if (summary.brlConsolidation.status === 'available') {
      expect(summary.brlConsolidation.balance.toDecimal()).toBe('0.00');
    }
  });

  it('does not drop a historical BRL balance with another scale', async () => {
    const app = useCase([account('legacy-brl', 'BRL')], {
      'legacy-brl': Money.fromDecimal('1.234', Currency.create('BRL', 3)),
    });

    const summary = await app.execute('owner-id');

    expect(summary.totalsByCurrency[0]?.toDecimal()).toBe('1.234');
    expect(summary.brlConsolidation).toEqual({
      reason: 'currency-scale-mismatch',
      status: 'unavailable',
    });
  });
});
