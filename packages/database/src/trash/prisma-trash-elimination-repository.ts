import type {
  TrashEliminationRepository,
  TrashEliminationTarget,
} from '@seshat/application';
import type {
  FinancialAuditEvent,
  Transaction,
  Transfer,
} from '@seshat/domain';

import { insertFinancialAuditEvent } from '../audit/index.js';
import type { Prisma, PrismaClient } from '../generated/prisma/client.js';

type TargetRow = Readonly<{
  resource_type: 'transaction' | 'transfer';
  id: string;
  owner_id: string;
}>;

class EliminationConflict extends Error {}

/**
 * Terminal elimination from the trash (RII-026 option b). Rows are marked,
 * never deleted, so revisions, links and the audit chain stay intact.
 */
export class PrismaTrashEliminationRepository implements TrashEliminationRepository {
  public constructor(private readonly client: PrismaClient) {}

  public async findExpiredTrash(
    cutoff: Date,
    limit: number,
  ): Promise<readonly TrashEliminationTarget[]> {
    const rows = await this.client.$queryRaw<TargetRow[]>`
      SELECT * FROM (
        SELECT 'transfer' AS resource_type, tr.id, tr.owner_id, s.trashed_at
        FROM transfers tr
        JOIN transactions s
          ON s.id = tr.source_transaction_id AND s.owner_id = tr.owner_id
        WHERE s.lifecycle = 'trashed'
          AND s.eliminated_at IS NULL
          AND s.trashed_at <= ${cutoff}
        UNION ALL
        SELECT 'transaction' AS resource_type, t.id, t.owner_id, t.trashed_at
        FROM transactions t
        WHERE t.lifecycle = 'trashed'
          AND t.eliminated_at IS NULL
          AND t.trashed_at <= ${cutoff}
          AND NOT EXISTS (
            SELECT 1 FROM transfers tr
            WHERE tr.owner_id = t.owner_id
              AND t.id IN (tr.source_transaction_id, tr.destination_transaction_id)
          )
          AND NOT EXISTS (
            SELECT 1 FROM refund_links r
            WHERE r.owner_id = t.owner_id
              AND t.id IN (r.expense_transaction_id, r.entry_transaction_id)
          )
          AND NOT EXISTS (
            SELECT 1 FROM balance_adjustments b
            WHERE b.owner_id = t.owner_id AND b.transaction_id = t.id
          )
      ) expired
      ORDER BY trashed_at, id
      LIMIT ${limit}`;
    return rows.map((row) => ({
      id: row.id,
      ownerId: row.owner_id,
      resourceType: row.resource_type,
    }));
  }

  public async hasRetentionLinks(
    transactionId: string,
    ownerId: string,
  ): Promise<boolean> {
    const [refunds, adjustments] = await Promise.all([
      this.client.refundLink.count({
        where: {
          ownerId,
          OR: [
            { expenseTransactionId: transactionId },
            { entryTransactionId: transactionId },
          ],
        },
      }),
      this.client.balanceAdjustment.count({
        where: { ownerId, transactionId },
      }),
    ]);
    return refunds + adjustments > 0;
  }

  public async eliminateTransaction(
    transaction: Transaction,
    expectedVersion: number,
    auditEvent: FinancialAuditEvent,
  ): Promise<boolean> {
    const snapshot = transaction.toSnapshot();
    try {
      await this.client.$transaction(async (client) => {
        await markEliminated(client, snapshot, expectedVersion);
        await insertFinancialAuditEvent(client, auditEvent);
      });
      return true;
    } catch (error) {
      if (error instanceof EliminationConflict) return false;
      throw error;
    }
  }

  public async eliminateTransfer(
    transfer: Transfer,
    expectedSourceVersion: number,
    expectedDestinationVersion: number,
    auditEvent: FinancialAuditEvent,
  ): Promise<boolean> {
    const snapshot = transfer.toSnapshot();
    try {
      await this.client.$transaction(async (client) => {
        await markEliminated(client, snapshot.source, expectedSourceVersion);
        await markEliminated(
          client,
          snapshot.destination,
          expectedDestinationVersion,
        );
        await insertFinancialAuditEvent(client, auditEvent);
      });
      return true;
    } catch (error) {
      if (error instanceof EliminationConflict) return false;
      throw error;
    }
  }
}

async function markEliminated(
  client: Prisma.TransactionClient,
  snapshot: ReturnType<Transaction['toSnapshot']>,
  expectedVersion: number,
): Promise<void> {
  const result = await client.transaction.updateMany({
    data: {
      eliminatedAt: snapshot.eliminatedAt ?? null,
      updatedAt: snapshot.updatedAt,
      version: snapshot.version,
    },
    where: {
      eliminatedAt: null,
      id: snapshot.id,
      lifecycle: 'trashed',
      ownerId: snapshot.ownerId,
      version: expectedVersion,
    },
  });
  if (result.count !== 1) throw new EliminationConflict();
}
