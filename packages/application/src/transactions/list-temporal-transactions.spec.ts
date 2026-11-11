import { Currency, Money, Transaction } from '@seshat/domain';
import { describe, expect, it, vi, type Mock } from 'vitest';

import {
  InvalidTemporalSelectionError,
  ListTemporalTransactionsUseCase,
  TemporalProfileUnavailableError,
  type TemporalTransaction,
} from './list-temporal-transactions.js';
import type { UserProfileRepository } from '../users/update-own-user-profile.js';

const newYork = 'America/New_York';

function transaction(
  instant: string,
  currencyCode: string,
  kind: 'income' | 'expense',
  amount: string,
  timeZone = newYork,
): TemporalTransaction {
  return {
    timeZone,
    transaction: Transaction.create({
      accountId: '7c2c7a54-73fe-49a3-b0ea-19034bf22baf',
      amount: Money.fromDecimal(amount, Currency.create(currencyCode, 2)),
      createdAt: new Date(instant),
      description: null,
      id: crypto.randomUUID(),
      kind,
      occurredAt: new Date(instant),
      ownerId: 'owner',
    }),
  };
}

type ListMock = Mock<
  (_owner: string, from: Date, to: Date) => Promise<TemporalTransaction[]>
>;

function createUseCase(
  items: readonly TemporalTransaction[],
  timeZone = newYork,
): {
  useCase: ListTemporalTransactionsUseCase;
  list: ListMock;
} {
  const list: ListMock = vi.fn((_owner: string, from: Date, to: Date) =>
    Promise.resolve(
      items.filter(
        (item) =>
          item.transaction.toSnapshot().occurredAt >= from &&
          item.transaction.toSnapshot().occurredAt < to,
      ),
    ),
  );
  const profiles = {
    findById: vi.fn(() => Promise.resolve({ timeZone })),
  } as unknown as UserProfileRepository;
  return {
    useCase: new ListTemporalTransactionsUseCase(
      { listWithTimeZoneForOwnerBetween: list },
      profiles,
    ),
    list,
  };
}

describe('ListTemporalTransactionsUseCase', () => {
  it('uses Sunday boundaries and preserves separate exact currency totals', async () => {
    const { useCase } = createUseCase([
      transaction('2026-11-02T05:00:00Z', 'BRL', 'income', '10.25'),
      transaction('2026-11-02T05:01:00Z', 'BRL', 'expense', '0.01'),
      transaction('2026-11-02T05:02:00Z', 'USD', 'income', '3.50'),
    ]);
    const view = await useCase.execute('owner', 'week', '2026-11-04');
    expect(view.days.map((day) => day.date)).toEqual([
      '2026-11-01',
      '2026-11-02',
      '2026-11-03',
      '2026-11-04',
      '2026-11-05',
      '2026-11-06',
      '2026-11-07',
    ]);
    expect(view.from).toEqual(new Date('2026-11-01T04:00:00Z'));
    expect(view.to).toEqual(new Date('2026-11-08T05:00:00Z'));
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

  it.each([
    ['a Sunday selects its own week', '2026-11-01', '2026-11-01', '2026-11-07'],
    ['a Saturday closes the week', '2026-11-07', '2026-11-01', '2026-11-07'],
    ['the next Sunday opens a week', '2026-11-08', '2026-11-08', '2026-11-14'],
  ])('%s', async (_name, selected, first, last) => {
    const { useCase } = createUseCase([]);
    const view = await useCase.execute('owner', 'week', selected);
    expect(view.days[0]?.date).toBe(first);
    expect(view.days.at(-1)?.date).toBe(last);
  });

  it('keeps adjacent weeks disjoint at the Saturday to Sunday boundary', async () => {
    const lastSaturdayInstant = transaction(
      '2026-11-08T04:59:59.999Z',
      'BRL',
      'income',
      '1.00',
    );
    const firstSundayInstant = transaction(
      '2026-11-08T05:00:00.000Z',
      'BRL',
      'income',
      '2.00',
    );
    const { useCase } = createUseCase([
      lastSaturdayInstant,
      firstSundayInstant,
    ]);
    const first = await useCase.execute('owner', 'week', '2026-11-07');
    const second = await useCase.execute('owner', 'week', '2026-11-08');
    expect(first.days.flatMap((day) => day.transactions)).toEqual([
      lastSaturdayInstant,
    ]);
    expect(second.days.flatMap((day) => day.transactions)).toEqual([
      firstSundayInstant,
    ]);
  });

  it('uses civil midnights across spring DST and excludes the next day', async () => {
    const { useCase } = createUseCase([
      transaction('2026-03-08T05:00:00Z', 'BRL', 'income', '1.00'),
      transaction('2026-03-09T04:00:00Z', 'BRL', 'income', '2.00'),
    ]);
    const view = await useCase.execute('owner', 'day', '2026-03-08');
    expect(view.from).toEqual(new Date('2026-03-08T05:00:00Z'));
    expect(view.to).toEqual(new Date('2026-03-09T04:00:00Z'));
    expect(view.days[0]?.transactions).toHaveLength(1);
  });

  it('buckets each transaction in its own time zone regardless of the profile', async () => {
    const instant = '2026-11-01T02:30:00Z';
    const items = [
      transaction(instant, 'BRL', 'income', '1.00', newYork),
      transaction(instant, 'BRL', 'income', '2.00', 'UTC'),
    ];
    const { useCase } = createUseCase(items, 'UTC');

    const october = await useCase.execute('owner', 'day', '2026-10-31');
    const november = await useCase.execute('owner', 'day', '2026-11-01');

    expect(october.days[0]?.transactions).toEqual([items[0]]);
    expect(october.totals[0]?.income).toBe('1.00');
    expect(november.days[0]?.transactions).toEqual([items[1]]);
    expect(november.totals[0]?.income).toBe('2.00');
  });

  it('requests a window wide enough for the extreme UTC offsets', async () => {
    // 00:00 on 2026-11-01 in UTC+14 and 23:59:59 on 2026-11-01 in UTC-12.
    const eastmost = transaction(
      '2026-10-31T10:00:00Z',
      'BRL',
      'income',
      '1.00',
      'Pacific/Kiritimati',
    );
    const westmost = transaction(
      '2026-11-02T11:59:59Z',
      'BRL',
      'income',
      '2.00',
      'Etc/GMT+12',
    );
    const { useCase, list } = createUseCase([eastmost, westmost], 'UTC');
    const view = await useCase.execute('owner', 'day', '2026-11-01');
    expect(list).toHaveBeenCalledWith(
      'owner',
      new Date('2026-10-31T00:00:00Z'),
      new Date('2026-11-03T00:00:00Z'),
      'active',
    );
    expect(view.days[0]?.transactions).toEqual([eastmost, westmost]);
  });

  it('excludes margin candidates from the period totals', async () => {
    const { useCase } = createUseCase(
      [transaction('2026-11-02T12:00:00Z', 'BRL', 'income', '9.00', 'UTC')],
      'UTC',
    );
    const view = await useCase.execute('owner', 'day', '2026-11-01');
    expect(view.days[0]?.transactions).toEqual([]);
    expect(view.totals).toEqual([]);
  });

  it('includes both repeated fall-back hours and excludes adjacent month boundaries', async () => {
    const { useCase } = createUseCase([
      transaction('2026-11-01T05:30:00Z', 'BRL', 'income', '1.00'),
      transaction('2026-11-01T06:30:00Z', 'BRL', 'income', '2.00'),
      transaction('2026-11-02T05:00:00Z', 'BRL', 'income', '3.00'),
    ]);
    const day = await useCase.execute('owner', 'day', '2026-11-01');
    expect(day.days[0]?.transactions).toHaveLength(2);
    expect(day.from).toEqual(new Date('2026-11-01T04:00:00Z'));
    expect(day.to).toEqual(new Date('2026-11-02T05:00:00Z'));

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
      { listWithTimeZoneForOwnerBetween: list },
      {
        findById: () => Promise.resolve(null),
      } as unknown as UserProfileRepository,
    );
    await expect(
      missing.execute('owner', 'day', '2026-11-02'),
    ).rejects.toBeInstanceOf(TemporalProfileUnavailableError);
    expect(list).not.toHaveBeenCalled();
  });

  it('keeps Sunday week boundaries across the year 0099 to 0100 transition', async () => {
    const { useCase } = createUseCase([], 'UTC');
    const view = await useCase.execute('owner', 'week', '0100-01-01');
    expect(view.days[0]?.date).toBe('0099-12-27');
    expect(view.days.at(-1)?.date).toBe('0100-01-02');
    expect(view.from).toEqual(new Date('0099-12-27T00:00:00.000Z'));
    expect(view.to).toEqual(new Date('0100-01-03T00:00:00.000Z'));
  });

  it('represents a skipped civil date as an empty day in a Pacific/Apia week', async () => {
    const apia = 'Pacific/Apia';
    const { useCase } = createUseCase(
      [
        transaction('2011-12-30T09:59:59.999Z', 'BRL', 'income', '1.00', apia),
        transaction('2011-12-30T10:00:00.000Z', 'BRL', 'income', '2.00', apia),
      ],
      apia,
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
