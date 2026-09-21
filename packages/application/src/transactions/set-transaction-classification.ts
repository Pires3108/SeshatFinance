import type { CategoryRepository } from '../classifications/manage-category.js';
import type { CostCenterRepository } from '../classifications/manage-cost-center.js';
import {
  OwnedTransactionNotFoundError,
  type TransactionRepository,
} from './create-transaction.js';

export type TransactionClassificationSelection = Readonly<{
  categoryId: string | null;
  costCenterId: string | null;
  subcategoryId: string | null;
}>;

export type ReplaceTransactionClassificationResult =
  | 'updated'
  | 'transaction-not-found'
  | 'category-not-found'
  | 'subcategory-not-found'
  | 'cost-center-not-found';

export interface TransactionClassificationRepository {
  getForOwner(
    transactionId: string,
    ownerId: string,
  ): Promise<TransactionClassificationSelection>;
  replaceForOwner(
    transactionId: string,
    ownerId: string,
    selection: TransactionClassificationSelection,
  ): Promise<ReplaceTransactionClassificationResult>;
}

export class InvalidOwnedTransactionClassificationError extends Error {
  public constructor() {
    super(
      'Every selected classification must belong to the transaction owner.',
    );
    this.name = 'InvalidOwnedTransactionClassificationError';
  }
}

export class InvalidSubcategorySelectionError extends Error {
  public constructor() {
    super(
      'The selected subcategory must belong to the selected root category.',
    );
    this.name = 'InvalidSubcategorySelectionError';
  }
}

export class SetOwnedTransactionClassificationUseCase {
  public constructor(
    private readonly transactions: TransactionRepository,
    private readonly categories: CategoryRepository,
    private readonly costCenters: CostCenterRepository,
    private readonly classifications: TransactionClassificationRepository,
  ) {}

  public async execute(command: {
    actorId: string;
    categoryId: string | null;
    costCenterId: string | null;
    subcategoryId: string | null;
    transactionId: string;
  }): Promise<TransactionClassificationSelection> {
    if (
      (await this.transactions.findByIdForOwner(
        command.transactionId,
        command.actorId,
      )) === null
    ) {
      throw new OwnedTransactionNotFoundError();
    }
    const selection: TransactionClassificationSelection = {
      categoryId: command.categoryId,
      costCenterId: command.costCenterId,
      subcategoryId: command.subcategoryId,
    };
    await this.assertValidSelection(selection, command.actorId);
    const result = await this.classifications.replaceForOwner(
      command.transactionId,
      command.actorId,
      selection,
    );
    if (result === 'transaction-not-found') {
      throw new OwnedTransactionNotFoundError();
    }
    if (result !== 'updated') {
      throw new InvalidOwnedTransactionClassificationError();
    }
    return selection;
  }

  private async assertValidSelection(
    selection: TransactionClassificationSelection,
    actorId: string,
  ): Promise<void> {
    const category =
      selection.categoryId === null
        ? null
        : await this.categories.findByIdForOwner(selection.categoryId, actorId);
    if (selection.categoryId !== null && category?.parentCategoryId !== null) {
      throw new InvalidOwnedTransactionClassificationError();
    }
    const subcategory =
      selection.subcategoryId === null
        ? null
        : await this.categories.findByIdForOwner(
            selection.subcategoryId,
            actorId,
          );
    if (
      selection.subcategoryId !== null &&
      (selection.categoryId === null ||
        subcategory?.parentCategoryId !== selection.categoryId)
    ) {
      throw new InvalidSubcategorySelectionError();
    }
    if (
      selection.costCenterId !== null &&
      (await this.costCenters.findByIdForOwner(
        selection.costCenterId,
        actorId,
      )) === null
    ) {
      throw new InvalidOwnedTransactionClassificationError();
    }
  }
}

export class GetOwnedTransactionClassificationUseCase {
  public constructor(
    private readonly transactions: TransactionRepository,
    private readonly classifications: TransactionClassificationRepository,
  ) {}

  public async execute(
    transactionId: string,
    actorId: string,
  ): Promise<TransactionClassificationSelection> {
    if (
      (await this.transactions.findByIdForOwner(transactionId, actorId)) ===
      null
    ) {
      throw new OwnedTransactionNotFoundError();
    }
    return this.classifications.getForOwner(transactionId, actorId);
  }
}
