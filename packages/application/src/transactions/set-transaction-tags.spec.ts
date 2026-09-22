import { Tag, Transaction, type FinancialAuditEvent } from '@seshat/domain';
import { describe, expect, it } from 'vitest';

import type { TagRepository } from '../classifications/manage-tag.js';
import {
  TransactionRequiresTransferMutationError,
  type TransactionFinancialLinkRepository,
  type TransactionRepository,
} from './create-transaction.js';
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

function links(
  transferId: string | null = null,
): TransactionFinancialLinkRepository {
  return {
    findTransferIdByEntryForOwner: () => Promise.resolve(transferId),
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
    let auditEvent: FinancialAuditEvent | undefined;
    const assignments: TransactionTagRepository = {
      listTagIdsForOwner: (): Promise<readonly string[]> => Promise.resolve([]),
      replaceForOwner: (_transactionId, _ownerId, tagIds, event) => {
        replaced = tagIds;
        auditEvent = event;
        return Promise.resolve('updated');
      },
    };
    const useCase = new SetOwnedTransactionTagsUseCase(
      transactions(value),
      links(),
      tags([first, second]),
      assignments,
      { now: () => now },
      { generate: () => 'audit-event-id' },
    );

    const result = await useCase.execute({
      actorId: value.ownerId,
      tagIds: [first.id, second.id, first.id],
      transactionId: value.id,
    });

    expect(result).toEqual([first.id, second.id]);
    expect(replaced).toEqual(result);
    expect(auditEvent?.toSnapshot()).toEqual({
      action: 'updated',
      actorId: value.ownerId,
      id: 'audit-event-id',
      occurredAt: now,
      ownerId: value.ownerId,
      resourceId: value.id,
      resourceType: 'transaction',
    });
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
      links(),
      tags([foreignTag]),
      assignments,
      { now: () => now },
      { generate: () => 'audit-event-id' },
    );

    await expect(
      useCase.execute({
        actorId: value.ownerId,
        tagIds: [foreignTag.id],
        transactionId: value.id,
      }),
    ).rejects.toBeInstanceOf(InvalidOwnedTagSelectionError);
  });

  it('rejects isolated tag changes for a transfer entry', async () => {
    const value = transaction();
    const useCase = new SetOwnedTransactionTagsUseCase(
      transactions(value),
      links('transfer-id'),
      tags([]),
      {
        listTagIdsForOwner: () => Promise.resolve([]),
        replaceForOwner: () => Promise.resolve('updated'),
      },
      { now: () => now },
      { generate: () => 'audit-event-id' },
    );

    await expect(
      useCase.execute({
        actorId: value.ownerId,
        tagIds: [],
        transactionId: value.id,
      }),
    ).rejects.toBeInstanceOf(TransactionRequiresTransferMutationError);
  });
});
