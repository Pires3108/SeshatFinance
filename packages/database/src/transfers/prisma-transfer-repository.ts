import type { TransferRepository } from '@seshat/application';
import type { Transaction, Transfer } from '@seshat/domain';

import type { Prisma, PrismaClient } from '../generated/prisma/client.js';

export class PrismaTransferRepository implements TransferRepository {
  public constructor(private readonly client: PrismaClient) {}

  public async insertAtomically(transfer: Transfer): Promise<void> {
    const snapshot = transfer.toSnapshot();
    await this.client.$transaction(async (client) => {
      await client.transaction.create({
        data: transactionCreateData(snapshot.source),
      });
      await client.transaction.create({
        data: transactionCreateData(snapshot.destination),
      });
      await client.transfer.create({
        data: {
          createdAt: snapshot.source.createdAt,
          destinationTransactionId: snapshot.destination.id,
          id: snapshot.id,
          ownerId: snapshot.ownerId,
          sourceTransactionId: snapshot.source.id,
        },
      });
    });
  }
}

function transactionCreateData(
  snapshot: ReturnType<Transaction['toSnapshot']>,
): Prisma.TransactionUncheckedCreateInput {
  return {
    accountId: snapshot.accountId,
    amountMinorUnits: minorUnits(
      snapshot.amount.amount,
      snapshot.amount.currency.minorUnitScale,
    ),
    archivedAt: snapshot.archivedAt,
    createdAt: snapshot.createdAt,
    currencyCode: snapshot.amount.currency.code,
    currencyMinorUnitScale: snapshot.amount.currency.minorUnitScale,
    description: snapshot.description,
    id: snapshot.id,
    kind: snapshot.kind,
    lifecycle: snapshot.lifecycle,
    observations: snapshot.observations,
    occurredAt: snapshot.occurredAt,
    ownerId: snapshot.ownerId,
    trashedAt: snapshot.trashedAt,
    updatedAt: snapshot.updatedAt,
    version: snapshot.version,
  };
}

function minorUnits(amount: string, scale: number): string {
  const [whole = '0', fraction = ''] = amount.split('.');
  return `${whole}${fraction.padEnd(scale, '0')}`;
}
