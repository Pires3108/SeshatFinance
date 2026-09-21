import type { TagRepository } from '../classifications/manage-tag.js';
import {
  OwnedTransactionNotFoundError,
  TransactionRequiresTransferMutationError,
  type TransactionFinancialLinkRepository,
  type TransactionRepository,
} from './create-transaction.js';

export type ReplaceTransactionTagsResult =
  'updated' | 'transaction-not-found' | 'tag-not-found';

export interface TransactionTagRepository {
  listTagIdsForOwner(
    transactionId: string,
    ownerId: string,
  ): Promise<readonly string[]>;
  replaceForOwner(
    transactionId: string,
    ownerId: string,
    tagIds: readonly string[],
  ): Promise<ReplaceTransactionTagsResult>;
}

export class InvalidOwnedTagSelectionError extends Error {
  public constructor() {
    super('Every selected tag must belong to the transaction owner.');
    this.name = 'InvalidOwnedTagSelectionError';
  }
}

export class SetOwnedTransactionTagsUseCase {
  public constructor(
    private readonly transactions: TransactionRepository,
    private readonly financialLinks: TransactionFinancialLinkRepository,
    private readonly tags: TagRepository,
    private readonly assignments: TransactionTagRepository,
  ) {}

  public async execute(command: {
    actorId: string;
    tagIds: readonly string[];
    transactionId: string;
  }): Promise<readonly string[]> {
    if (
      (await this.transactions.findByIdForOwner(
        command.transactionId,
        command.actorId,
      )) === null
    ) {
      throw new OwnedTransactionNotFoundError();
    }
    const transferId = await this.financialLinks.findTransferIdByEntryForOwner(
      command.transactionId,
      command.actorId,
    );
    if (transferId !== null) {
      throw new TransactionRequiresTransferMutationError(transferId);
    }
    const tagIds = [...new Set(command.tagIds)];
    const selectedTags = await Promise.all(
      tagIds.map((tagId) => this.tags.findByIdForOwner(tagId, command.actorId)),
    );
    if (selectedTags.some((tag) => tag === null)) {
      throw new InvalidOwnedTagSelectionError();
    }
    const result = await this.assignments.replaceForOwner(
      command.transactionId,
      command.actorId,
      tagIds,
    );
    if (result === 'transaction-not-found') {
      throw new OwnedTransactionNotFoundError();
    }
    if (result === 'tag-not-found') {
      throw new InvalidOwnedTagSelectionError();
    }
    return tagIds;
  }
}

export class ListOwnedTransactionTagsUseCase {
  public constructor(
    private readonly transactions: TransactionRepository,
    private readonly assignments: TransactionTagRepository,
  ) {}

  public async execute(
    transactionId: string,
    actorId: string,
  ): Promise<readonly string[]> {
    if (
      (await this.transactions.findByIdForOwner(transactionId, actorId)) ===
      null
    ) {
      throw new OwnedTransactionNotFoundError();
    }
    return this.assignments.listTagIdsForOwner(transactionId, actorId);
  }
}
