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
      await client.$queryRaw`
        SELECT id FROM transactions
        WHERE id = ${transactionId}::uuid AND owner_id = ${ownerId}::uuid
        FOR UPDATE`;
      const transaction = await client.transaction.findFirst({
        select: { id: true },
        where: { id: transactionId, ownerId },
      });
      if (transaction === null) return 'transaction-not-found';
      const current = await client.transactionTag.findMany({
        orderBy: { tagId: 'asc' },
        select: { tagId: true },
        where: { ownerId, transactionId },
      });
      const next = [...new Set(tagIds)].sort();
      const currentIds = new Set(current.map(({ tagId }) => tagId));
      for (const tagId of next) {
        await client.$queryRaw`
          SELECT id FROM tags
          WHERE id = ${tagId}::uuid AND owner_id = ${ownerId}::uuid
          FOR SHARE`;
        const tag = await client.tag.findFirst({
          select: { id: true, archivedAt: true },
          where: { id: tagId, ownerId },
        });
        if (tag === null || (tag.archivedAt !== null && !currentIds.has(tagId)))
          return 'tag-not-found';
      }
      if (
        current.length === next.length &&
        current.every(({ tagId }, index) => tagId === next[index])
      ) {
        return 'unchanged';
      }
      await client.transactionTag.deleteMany({
        where: { ownerId, transactionId, tagId: { notIn: next } },
      });
      const added = next.filter((tagId) => !currentIds.has(tagId));
      if (added.length > 0) {
        await client.transactionTag.createMany({
          data: added.map((tagId) => ({ ownerId, tagId, transactionId })),
        });
      }
      await insertFinancialAuditEvent(client, auditEvent);
      return 'updated';
    });
  }
}
