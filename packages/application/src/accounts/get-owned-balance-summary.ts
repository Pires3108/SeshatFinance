import { Currency, Money, type Account } from '@seshat/domain';

import type { GetOwnedAccountBalanceUseCase } from './get-account-balance.js';

export interface OwnedBalanceSummaryAccountRepository {
  listForOwnedBalanceSummary(ownerId: string): Promise<readonly Account[]>;
}

export type OwnedAccountBalance = Readonly<{
  accountId: string;
  balance: Money;
}>;

export type BrlConsolidation =
  | Readonly<{ status: 'available'; balance: Money }>
  | Readonly<{
      status: 'unavailable';
      reason: 'conversion-policy-pending' | 'currency-scale-mismatch';
    }>;

export type OwnedBalanceSummary = Readonly<{
  accountBalances: readonly OwnedAccountBalance[];
  totalsByCurrency: readonly Money[];
  brlConsolidation: BrlConsolidation;
}>;

export class GetOwnedBalanceSummaryUseCase {
  public constructor(
    private readonly accounts: OwnedBalanceSummaryAccountRepository,
    private readonly balances: GetOwnedAccountBalanceUseCase,
  ) {}

  public async execute(actorId: string): Promise<OwnedBalanceSummary> {
    const accounts = await this.accounts.listForOwnedBalanceSummary(actorId);
    const accountBalances: OwnedAccountBalance[] = [];
    const totals = new Map<string, Money>();

    for (const account of accounts) {
      const balance = await this.balances.execute(account.id, actorId);
      accountBalances.push({ accountId: account.id, balance });
      const key = `${balance.currency.code}:${String(balance.currency.minorUnitScale)}`;
      totals.set(
        key,
        (totals.get(key) ?? Money.fromMinorUnits(0n, balance.currency)).add(
          balance,
        ),
      );
    }

    const totalsByCurrency = [...totals.values()].sort((left, right) =>
      left.currency.code.localeCompare(right.currency.code),
    );
    const hasForeignCurrency = totalsByCurrency.some(
      (total) => total.currency.code !== 'BRL',
    );
    const hasUnsupportedBrlScale = totalsByCurrency.some(
      (total) =>
        total.currency.code === 'BRL' && total.currency.minorUnitScale !== 2,
    );
    const brlConsolidation: BrlConsolidation = hasForeignCurrency
      ? { reason: 'conversion-policy-pending', status: 'unavailable' }
      : hasUnsupportedBrlScale
        ? { reason: 'currency-scale-mismatch', status: 'unavailable' }
        : {
            balance:
              totalsByCurrency[0] ??
              Money.fromMinorUnits(0n, Currency.create('BRL', 2)),
            status: 'available',
          };

    return { accountBalances, brlConsolidation, totalsByCurrency };
  }
}
