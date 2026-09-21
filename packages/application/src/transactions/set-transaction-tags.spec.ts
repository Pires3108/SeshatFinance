import { Tag, Transaction } from '@seshat/domain';
import { describe, expect, it } from 'vitest';

import type { TagRepository } from '../classifications/manage-tag.js';
import type { TransactionRepository } from './create-transaction.js';
import {
  InvalidOwnedTagSelectionError,
  SetOwnedTransactionTagsUseCase,
  type TransactionTagRepository,
} from './set-transaction-tags.js';

const now = new Date('2026-09-20T12:00:00.000Z');

function tags(values: readonly Tag[]): TagRepository {
  return {
    findByIdForOwner: (id, ownerId): Promise<Tag | null> =>
      Promise.resolve(
        values.find((tag) => tag.id === id && tag.ownerId === ownerId) ?? null,
      ),
    insert: (): Promise<void> => Promise.resolve(),
    listForOwner: (): Promise<readonly Tag[]> => Promise.resolve(values),
    save: (): Promise<boolean> => Promise.resolve(true),
  };
}

function transactions(value: Transaction): TransactionRepository {
  return {
    findByIdForOwner: (id, ownerId): Promise<Transaction | null> =>
      Promise.resolve(
        value.id === id && value.ownerId === ownerId ? value : null,
      ),
    insert: (): Promise<void> => Promise.resolve(),
    listForAccountOwner: (): Promise<readonly Transaction[]> =>
      Promise.resolve([]),
    save: (): Promise<boolean> => Promise.resolve(true),
  };
}

function transaction(): Transaction {
  return Transaction.restore({
    accountId: 'account-id',
    amount: { amount: '10.00', currency: { code: 'BRL', minorUnitScale: 2 } },
    archivedAt: null,
    createdAt: now,
    description: null,
    id: 'transaction-id',
    kind: 'expense',
    lifecycle: 'active',
    observations: null,
    occurredAt: now,
    ownerId: 'owner-id',
    trashedAt: null,
    updatedAt: now,
    version: 1,
  });
}

function tag(id: string, ownerId = 'owner-id'): Tag {
  return Tag.create({ createdAt: now, id, name: id, ownerId });
}

describe('SetOwnedTransactionTagsUseCase', () => {
  it('atomically replaces a deduplicated owned tag selection', async () => {
    const value = transaction();
    const first = tag('first-tag-id');
    const second = tag('second-tag-id');
    let replaced: readonly string[] = [];
    const assignments: TransactionTagRepository = {
      listTagIdsForOwner: (): Promise<readonly string[]> => Promise.resolve([]),
      replaceForOwner: (_transactionId, _ownerId, tagIds) => {
        replaced = tagIds;
        return Promise.resolve('updated');
      },
    };
    const useCase = new SetOwnedTransactionTagsUseCase(
      transactions(value),
      tags([first, second]),
      assignments,
    );

    const result = await useCase.execute({
      actorId: value.ownerId,
      tagIds: [first.id, second.id, first.id],
      transactionId: value.id,
    });

    expect(result).toEqual([first.id, second.id]);
    expect(replaced).toEqual(result);
  });

  it('rejects a tag owned by another actor before replacement', async () => {
    const value = transaction();
    const foreignTag = tag('foreign-tag-id', 'other-owner-id');
    const assignments: TransactionTagRepository = {
      listTagIdsForOwner: (): Promise<readonly string[]> => Promise.resolve([]),
      replaceForOwner: (): Promise<'updated'> => Promise.resolve('updated'),
    };
    const useCase = new SetOwnedTransactionTagsUseCase(
      transactions(value),
      tags([foreignTag]),
      assignments,
    );

    await expect(
      useCase.execute({
        actorId: value.ownerId,
        tagIds: [foreignTag.id],
        transactionId: value.id,
      }),
    ).rejects.toBeInstanceOf(InvalidOwnedTagSelectionError);
  });
});
