import { describe, expect, it } from 'vitest';

import { Currency } from '../money/currency.js';
import { Money } from '../money/money.js';
import { InvalidTransferError, Transfer } from './transfer.js';

const base = {
  amount: Money.fromDecimal('125.30', Currency.create('BRL', 2)),
  createdAt: new Date('2026-09-21T14:00:00.000Z'),
  description: 'Transferência declarada',
  destinationAccountId: 'destination-account-id',
  destinationTransactionId: 'destination-transaction-id',
  id: 'transfer-id',
  observations: null,
  occurredAt: new Date('2026-09-21T13:00:00.000Z'),
  ownerId: 'owner-id',
  sourceAccountId: 'source-account-id',
  sourceTransactionId: 'source-transaction-id',
} as const;

describe('Transfer', () => {
  it('creates inseparable opposite entries that preserve net worth', () => {
    const transfer = Transfer.create(base);

    expect(transfer.netBalanceEffect().toDecimal()).toBe('0.00');
    expect(transfer.toSnapshot()).toMatchObject({
      destination: { accountId: 'destination-account-id', kind: 'income' },
      source: { accountId: 'source-account-id', kind: 'expense' },
    });
  });

  it('rejects a transfer within the same account', () => {
    expect(() =>
      Transfer.create({ ...base, destinationAccountId: 'source-account-id' }),
    ).toThrow(InvalidTransferError);
  });

  it('restores and changes both lifecycle entries together', () => {
    const created = Transfer.create(base);
    const restored = Transfer.restore(created.toSnapshot());
    const archivedAt = new Date('2026-09-21T15:00:00.000Z');
    const trashedAt = new Date('2026-09-21T16:00:00.000Z');
    const restoredAt = new Date('2026-09-21T17:00:00.000Z');

    restored.archive(archivedAt);
    expect(restored.toSnapshot()).toMatchObject({
      destination: { lifecycle: 'archived', version: 2 },
      source: { lifecycle: 'archived', version: 2 },
    });

    restored.moveToTrash(trashedAt);
    expect(restored.netBalanceEffect().toDecimal()).toBe('0.00');
    expect(restored.toSnapshot()).toMatchObject({
      destination: { lifecycle: 'trashed', version: 3 },
      source: { lifecycle: 'trashed', version: 3 },
    });

    restored.restoreFromTrash(restoredAt);
    expect(restored.toSnapshot()).toMatchObject({
      destination: { lifecycle: 'archived', version: 4 },
      source: { lifecycle: 'archived', version: 4 },
    });
  });

  it('rejects restoring an incoherent persisted pair', () => {
    const snapshot = Transfer.create(base).toSnapshot();

    expect(() =>
      Transfer.restore({
        ...snapshot,
        destination: {
          ...snapshot.destination,
          lifecycle: 'archived',
          archivedAt: new Date('2026-09-21T15:00:00.000Z'),
        },
      }),
    ).toThrow(InvalidTransferError);
  });
});
