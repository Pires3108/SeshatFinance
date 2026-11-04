import { Currency, Money, Transaction } from '@seshat/domain';
import { describe, expect, it, vi, type Mock } from 'vitest';

import {
  InvalidTemporalSelectionError,
  ListTemporalTransactionsUseCase,
  TemporalProfileUnavailableError,
} from './list-temporal-transactions.js';
import type { UserProfileRepository } from '../users/update-own-user-profile.js';

function transaction(
  instant: string,
  currencyCode: string,
  kind: 'income' | 'expense',
  amount: string,
): Transaction {
  return Transaction.create({
    accountId: '7c2c7a54-73fe-49a3-b0ea-19034bf22baf',
    amount: Money.fromDecimal(amount, Currency.create(currencyCode, 2)),
    createdAt: new Date(instant),
    description: null,
    id: crypto.randomUUID(),
    kind,
    occurredAt: new Date(instant),
    ownerId: 'owner',
  });
}

function createUseCase(
  items: readonly Transaction[],
  timeZone = 'America/New_York',
): {
  useCase: ListTemporalTransactionsUseCase;
  list: Mock<(_owner: string, from: Date, to: Date) => Promise<Transaction[]>>;
} {
  const list = vi.fn((_owner: string, from: Date, to: Date) =>
    Promise.resolve(
      items.filter(
        (item) =>
          item.toSnapshot().occurredAt >= from &&
          item.toSnapshot().occurredAt < to,
      ),
    ),
  );
  const profiles = {
    findById: vi.fn(() => Promise.resolve({ timeZone })),
  } as unknown as UserProfileRepository;
  return {
    useCase: new ListTemporalTransactionsUseCase(
      { listForOwnerBetween: list },
      profiles,
    ),
    list,
  };
}

describe('ListTemporalTransactionsUseCase', () => {
  it('uses Monday boundaries and preserves separate exact currency totals', async () => {
    const { useCase, list } = createUseCase([
      transaction('2026-11-02T05:00:00Z', 'BRL', 'income', '10.25'),
      transaction('2026-11-02T05:01:00Z', 'BRL', 'expense', '0.01'),
      transaction('2026-11-02T05:02:00Z', 'USD', 'income', '3.50'),
    ]);
    const view = await useCase.execute('owner', 'week', '2026-11-04');
    expect(view.days.map((day) => day.date)).toEqual([
      '2026-11-02',
      '2026-11-03',
      '2026-11-04',
      '2026-11-05',
      '2026-11-06',
      '2026-11-07',
      '2026-11-08',
    ]);
    expect(list).toHaveBeenCalledWith(
      'owner',
      new Date('2026-11-02T05:00:00Z'),
      new Date('2026-11-09T05:00:00Z'),
      'active',
    );
    expect(view.totals).toEqual([
      {
        currencyCode: 'BRL',
        currencyMinorUnitScale: 2,
        income: '10.25',
        expense: '0.01',
      },
      {
        currencyCode: 'USD',
        currencyMinorUnitScale: 2,
        income: '3.50',
        expense: '0.00',
      },
    ]);
  });

  it('uses civil midnights across spring DST and excludes the next day', async () => {
    const { useCase, list } = createUseCase([
      transaction('2026-03-08T05:00:00Z', 'BRL', 'income', '1.00'),
      transaction('2026-03-09T04:00:00Z', 'BRL', 'income', '2.00'),
    ]);
    const view = await useCase.execute('owner', 'day', '2026-03-08');
    expect(list).toHaveBeenCalledWith(
      'owner',
      new Date('2026-03-08T05:00:00Z'),
      new Date('2026-03-09T04:00:00Z'),
      'active',
    );
    expect(view.days[0]?.transactions).toHaveLength(1);
  });

  it('re-buckets stored instants after a profile timezone change', async () => {
    const items = [
      transaction('2026-11-01T02:30:00Z', 'BRL', 'income', '1.00'),
    ];
    const newYork = await createUseCase(items).useCase.execute(
      'owner',
      'day',
      '2026-10-31',
    );
    const utc = await createUseCase(items, 'UTC').useCase.execute(
      'owner',
      'day',
      '2026-10-31',
    );
    expect(newYork.days[0]?.transactions).toHaveLength(1);
    expect(utc.days[0]?.transactions).toHaveLength(0);
  });

  it('includes both repeated fall-back hours and excludes adjacent month boundaries', async () => {
    const { useCase, list } = createUseCase([
      transaction('2026-11-01T05:30:00Z', 'BRL', 'income', '1.00'),
      transaction('2026-11-01T06:30:00Z', 'BRL', 'income', '2.00'),
      transaction('2026-11-02T05:00:00Z', 'BRL', 'income', '3.00'),
    ]);
    const day = await useCase.execute('owner', 'day', '2026-11-01');
    expect(day.days[0]?.transactions).toHaveLength(2);
    expect(list).toHaveBeenCalledWith(
      'owner',
      new Date('2026-11-01T04:00:00Z'),
      new Date('2026-11-02T05:00:00Z'),
      'active',
    );

    const month = await useCase.execute('owner', 'month', '2026-11-30');
    expect(month.from).toEqual(new Date('2026-11-01T04:00:00Z'));
    expect(month.to).toEqual(new Date('2026-12-01T05:00:00Z'));
    expect(month.days).toHaveLength(30);
  });

  it('rejects years affected by Date.UTC year remapping and requires a profile', async () => {
    const { useCase, list } = createUseCase([]);
    await expect(
      useCase.execute('owner', 'month', '0099-12-01'),
    ).rejects.toBeInstanceOf(InvalidTemporalSelectionError);
    expect(list).not.toHaveBeenCalled();
    const missing = new ListTemporalTransactionsUseCase(
      { listForOwnerBetween: list },
      {
        findById: () => Promise.resolve(null),
      } as unknown as UserProfileRepository,
    );
    await expect(
      missing.execute('owner', 'day', '2026-11-02'),
    ).rejects.toBeInstanceOf(TemporalProfileUnavailableError);
    expect(list).not.toHaveBeenCalled();
  });

  it('keeps Monday week boundaries across the year 0099 to 0100 transition', async () => {
    const { useCase, list } = createUseCase([], 'UTC');
    const view = await useCase.execute('owner', 'week', '0100-01-01');
    expect(view.days[0]?.date).toBe('0099-12-28');
    expect(view.days.at(-1)?.date).toBe('0100-01-03');
    expect(list).toHaveBeenCalledWith(
      'owner',
      new Date('0099-12-28T00:00:00.000Z'),
      new Date('0100-01-04T00:00:00.000Z'),
      'active',
    );
  });

  it('represents a skipped civil date as an empty day in a Pacific/Apia week', async () => {
    const { useCase } = createUseCase(
      [
        transaction('2011-12-30T09:59:59.999Z', 'BRL', 'income', '1.00'),
        transaction('2011-12-30T10:00:00.000Z', 'BRL', 'income', '2.00'),
      ],
      'Pacific/Apia',
    );
    const week = await useCase.execute('owner', 'week', '2011-12-30');
    expect(
      week.days.find((day) => day.date === '2011-12-29')?.transactions,
    ).toHaveLength(1);
    expect(
      week.days.find((day) => day.date === '2011-12-30')?.transactions,
    ).toHaveLength(0);
    expect(
      week.days.find((day) => day.date === '2011-12-31')?.transactions,
    ).toHaveLength(1);
    const skippedDay = await useCase.execute('owner', 'day', '2011-12-30');
    expect(skippedDay.from).toEqual(skippedDay.to);
    expect(skippedDay.days[0]?.transactions).toHaveLength(0);
  });
});
