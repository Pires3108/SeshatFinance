import type {
  ReplaceTransactionClassificationResult,
  TransactionClassificationRepository,
  TransactionClassificationSelection,
} from '@seshat/application';
import type { FinancialAuditEvent } from '@seshat/domain';

import { insertFinancialAuditEvent } from '../audit/prisma-financial-audit-event-repository.js';
import type { PrismaClient } from '../generated/prisma/client.js';

export class PrismaTransactionClassificationRepository implements TransactionClassificationRepository {
  public constructor(private readonly client: PrismaClient) {}

  public async getForOwner(
    transactionId: string,
    ownerId: string,
  ): Promise<TransactionClassificationSelection> {
    const value = await this.client.transaction.findFirstOrThrow({
      select: { categoryId: true, costCenterId: true, subcategoryId: true },
      where: { id: transactionId, ownerId },
    });
    return value;
  }

  public replaceForOwner(
    transactionId: string,
    ownerId: string,
    selection: TransactionClassificationSelection,
    auditEvent: FinancialAuditEvent,
  ): Promise<ReplaceTransactionClassificationResult> {
    return this.client.$transaction(async (client) => {
      const transaction = await client.transaction.findFirst({
        select: {
          categoryId: true,
          costCenterId: true,
          id: true,
          subcategoryId: true,
        },
        where: { id: transactionId, ownerId },
      });
      if (transaction === null) return 'transaction-not-found';
      if (selection.categoryId !== null) {
        const category = await client.category.findFirst({
          select: { id: true },
          where: { id: selection.categoryId, ownerId, parentCategoryId: null },
        });
        if (category === null) return 'category-not-found';
      }
      if (selection.subcategoryId !== null) {
        if (selection.categoryId === null) return 'subcategory-not-found';
        const subcategory = await client.category.findFirst({
          select: { id: true },
          where: {
            id: selection.subcategoryId,
            ownerId,
            parentCategoryId: selection.categoryId,
          },
        });
        if (subcategory === null) return 'subcategory-not-found';
      }
      if (selection.costCenterId !== null) {
        const costCenter = await client.costCenter.findFirst({
          select: { id: true },
          where: { id: selection.costCenterId, ownerId },
        });
        if (costCenter === null) return 'cost-center-not-found';
      }
      if (
        transaction.categoryId === selection.categoryId &&
        transaction.costCenterId === selection.costCenterId &&
        transaction.subcategoryId === selection.subcategoryId
      ) {
        return 'unchanged';
      }
      await client.transaction.update({
        data: selection,
        where: { id_ownerId: { id: transactionId, ownerId } },
      });
      await insertFinancialAuditEvent(client, auditEvent);
      return 'updated';
    });
  }
}
