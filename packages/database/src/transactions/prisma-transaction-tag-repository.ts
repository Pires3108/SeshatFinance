import type {
  ReplaceTransactionTagsResult,
  TransactionTagRepository,
} from '@seshat/application';
import type { FinancialAuditEvent } from '@seshat/domain';

import { insertFinancialAuditEvent } from '../audit/index.js';
import type { PrismaClient } from '../generated/prisma/client.js';

export class PrismaTransactionTagRepository implements TransactionTagRepository {
  public constructor(private readonly client: PrismaClient) {}

  public async listTagIdsForOwner(
    transactionId: string,
    ownerId: string,
  ): Promise<readonly string[]> {
    const assignments = await this.client.transactionTag.findMany({
      orderBy: { tagId: 'asc' },
      select: { tagId: true },
      where: { ownerId, transactionId },
    });
    return assignments.map(({ tagId }) => tagId);
  }

  public replaceForOwner(
    transactionId: string,
    ownerId: string,
    tagIds: readonly string[],
    auditEvent: FinancialAuditEvent,
  ): Promise<ReplaceTransactionTagsResult> {
    return this.client.$transaction(async (client) => {
      const transaction = await client.transaction.findFirst({
        select: { id: true },
        where: { id: transactionId, ownerId },
      });
      if (transaction === null) return 'transaction-not-found';
      const tagCount = await client.tag.count({
        where: { id: { in: [...tagIds] }, ownerId },
      });
      if (tagCount !== tagIds.length) return 'tag-not-found';
      const current = await client.transactionTag.findMany({
        orderBy: { tagId: 'asc' },
        select: { tagId: true },
        where: { ownerId, transactionId },
      });
      const next = [...tagIds].sort();
      if (
        current.length === next.length &&
        current.every(({ tagId }, index) => tagId === next[index])
      ) {
        return 'unchanged';
      }
      await client.transactionTag.deleteMany({
        where: { ownerId, transactionId },
      });
      if (tagIds.length > 0) {
        await client.transactionTag.createMany({
          data: tagIds.map((tagId) => ({ ownerId, tagId, transactionId })),
        });
      }
      await insertFinancialAuditEvent(client, auditEvent);
      return 'updated';
    });
  }
}
