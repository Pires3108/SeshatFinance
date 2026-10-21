import type {
  ReplaceTransactionClassificationResult,
  TransactionClassificationRepository,
  TransactionClassificationSelection,
} from '@seshat/application';
import type { FinancialAuditEvent } from '@seshat/domain';

import { insertFinancialAuditEvent } from '../audit/index.js';
import type { PrismaClient } from '../generated/prisma/client.js';

export class PrismaTransactionClassificationRepository implements TransactionClassificationRepository {
  public constructor(private readonly client: PrismaClient) {}

  public async getForOwner(
    transactionId: string,
    ownerId: string,
  ): Promise<TransactionClassificationSelection | null> {
    const value = await this.client.transaction.findFirst({
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
      await client.$queryRaw`
        SELECT id FROM transactions
        WHERE id = ${transactionId}::uuid AND owner_id = ${ownerId}::uuid
        FOR UPDATE`;
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
        await client.$queryRaw`
          SELECT id FROM categories
          WHERE id = ${selection.categoryId}::uuid AND owner_id = ${ownerId}::uuid
          FOR SHARE`;
        const category = await client.category.findFirst({
          select: { id: true },
          where: {
            id: selection.categoryId,
            ownerId,
            parentCategoryId: null,
            archivedAt: null,
          },
        });
        if (category === null) return 'category-not-found';
      }
      if (selection.subcategoryId !== null) {
        if (selection.categoryId === null) return 'subcategory-not-found';
        await client.$queryRaw`
          SELECT id FROM categories
          WHERE id = ${selection.subcategoryId}::uuid AND owner_id = ${ownerId}::uuid
          FOR SHARE`;
        const subcategory = await client.category.findFirst({
          select: { id: true },
          where: {
            id: selection.subcategoryId,
            ownerId,
            parentCategoryId: selection.categoryId,
            archivedAt: null,
          },
        });
        if (subcategory === null) return 'subcategory-not-found';
      }
      if (selection.costCenterId !== null) {
        await client.$queryRaw`
          SELECT id FROM cost_centers
          WHERE id = ${selection.costCenterId}::uuid AND owner_id = ${ownerId}::uuid
          FOR SHARE`;
        const costCenter = await client.costCenter.findFirst({
          select: { id: true, archivedAt: true },
          where: { id: selection.costCenterId, ownerId },
        });
        if (
          costCenter === null ||
          (costCenter.archivedAt !== null &&
            transaction.costCenterId !== selection.costCenterId)
        )
          return 'cost-center-not-found';
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
