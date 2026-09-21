import {
  Category,
  CostCenter,
  Currency,
  Money,
  Transaction,
} from '@seshat/domain';
import { describe, expect, it } from 'vitest';

import type { CategoryRepository } from '../classifications/manage-category.js';
import type { CostCenterRepository } from '../classifications/manage-cost-center.js';
import {
  TransactionRequiresTransferMutationError,
  type TransactionFinancialLinkRepository,
  type TransactionRepository,
} from './create-transaction.js';
import {
  InvalidOwnedTransactionClassificationError,
  InvalidSubcategorySelectionError,
  SetOwnedTransactionClassificationUseCase,
  type TransactionClassificationRepository,
  type TransactionClassificationSelection,
} from './set-transaction-classification.js';

const now = new Date('2026-09-21T12:00:00.000Z');
const ownerId = 'owner-id';

function transaction(): Transaction {
  return Transaction.create({
    accountId: 'account-id',
    amount: Money.fromDecimal('10.00', Currency.create('BRL', 2)),
    createdAt: now,
    description: null,
    id: 'transaction-id',
    kind: 'expense',
    occurredAt: now,
    ownerId,
  });
}

function category(id: string, parentCategoryId: string | null): Category {
  return Category.create({
    createdAt: now,
    id,
    name: id,
    ownerId,
    parentCategoryId,
  });
}

function createUseCase(values: {
  categories: readonly Category[];
  costCenters?: readonly CostCenter[];
  onReplace?: (selection: TransactionClassificationSelection) => void;
  transferId?: string | null;
}): SetOwnedTransactionClassificationUseCase {
  const transactions: TransactionRepository = {
    findByIdForOwner: (id, actorId) =>
      Promise.resolve(
        id === 'transaction-id' && actorId === ownerId ? transaction() : null,
      ),
    insert: () => Promise.resolve(),
    listForAccountOwner: () => Promise.resolve([]),
    save: () => Promise.resolve(true),
  };
  const categories: CategoryRepository = {
    findByIdForOwner: (id, actorId) =>
      Promise.resolve(
        values.categories.find(
          (value) => value.id === id && value.ownerId === actorId,
        ) ?? null,
      ),
    insert: () => Promise.resolve(),
    listForOwner: () => Promise.resolve(values.categories),
    save: () => Promise.resolve(true),
  };
  const links: TransactionFinancialLinkRepository = {
    findTransferIdByEntryForOwner: () =>
      Promise.resolve(values.transferId ?? null),
  };
  const costCenters: CostCenterRepository = {
    findByIdForOwner: (id, actorId) =>
      Promise.resolve(
        values.costCenters?.find(
          (value) => value.id === id && value.ownerId === actorId,
        ) ?? null,
      ),
    insert: () => Promise.resolve(),
    listForOwner: () => Promise.resolve(values.costCenters ?? []),
    save: () => Promise.resolve(true),
  };
  const classifications: TransactionClassificationRepository = {
    getForOwner: () =>
      Promise.resolve({
        categoryId: null,
        costCenterId: null,
        subcategoryId: null,
      }),
    replaceForOwner: (_transactionId, _actorId, selection) => {
      values.onReplace?.(selection);
      return Promise.resolve('updated');
    },
  };
  return new SetOwnedTransactionClassificationUseCase(
    transactions,
    links,
    categories,
    costCenters,
    classifications,
  );
}

describe('SetOwnedTransactionClassificationUseCase', () => {
  it('atomically selects an owned root, child, and cost center', async () => {
    const root = category('root-id', null);
    const child = category('child-id', root.id);
    const center = CostCenter.create({
      createdAt: now,
      id: 'cost-center-id',
      name: 'Casa',
      ownerId,
    });
    let replaced: TransactionClassificationSelection | undefined;
    const useCase = createUseCase({
      categories: [root, child],
      costCenters: [center],
      onReplace: (selection) => {
        replaced = selection;
      },
    });

    const result = await useCase.execute({
      actorId: ownerId,
      categoryId: root.id,
      costCenterId: center.id,
      subcategoryId: child.id,
      transactionId: 'transaction-id',
    });

    expect(result).toEqual(replaced);
  });

  it('rejects a child from another root', async () => {
    const root = category('root-id', null);
    const child = category('child-id', 'other-root-id');
    const useCase = createUseCase({ categories: [root, child] });

    await expect(
      useCase.execute({
        actorId: ownerId,
        categoryId: root.id,
        costCenterId: null,
        subcategoryId: child.id,
        transactionId: 'transaction-id',
      }),
    ).rejects.toBeInstanceOf(InvalidSubcategorySelectionError);
  });

  it('rejects a foreign or missing cost center', async () => {
    const useCase = createUseCase({ categories: [] });

    await expect(
      useCase.execute({
        actorId: ownerId,
        categoryId: null,
        costCenterId: 'missing-id',
        subcategoryId: null,
        transactionId: 'transaction-id',
      }),
    ).rejects.toBeInstanceOf(InvalidOwnedTransactionClassificationError);
  });

  it('rejects isolated classification changes for a transfer entry', async () => {
    const useCase = createUseCase({
      categories: [],
      transferId: 'transfer-id',
    });

    await expect(
      useCase.execute({
        actorId: ownerId,
        categoryId: null,
        costCenterId: null,
        subcategoryId: null,
        transactionId: 'transaction-id',
      }),
    ).rejects.toBeInstanceOf(TransactionRequiresTransferMutationError);
  });
});
