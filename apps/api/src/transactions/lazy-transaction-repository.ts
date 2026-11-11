import type {
  AccountTransactionBalanceRepository,
  TemporalTransaction,
  TransactionFinancialLinkRepository,
  TransactionRepository,
  TransactionTimelineFilters,
  TransactionRevision,
} from '@seshat/application';
import type {
  FinancialAuditEvent,
  Money,
  Transaction,
  TransactionLifecycle,
} from '@seshat/domain';
import { PrismaTransactionRepository } from '@seshat/database';
import { Injectable } from '@nestjs/common';

import { LazyPrismaClient } from '../platform/lazy-prisma-client.js';

@Injectable()
export class LazyTransactionRepository
  implements
    TransactionRepository,
    TransactionFinancialLinkRepository,
    AccountTransactionBalanceRepository
{
  private repository: PrismaTransactionRepository | undefined;
  public constructor(private readonly prisma: LazyPrismaClient) {}
  public insert(
    transaction: Transaction,
    auditEvent: FinancialAuditEvent,
    idempotency?: Readonly<{ key: string; fingerprint: string }>,
  ): Promise<void> {
    return this.getRepository().insert(transaction, auditEvent, idempotency);
  }
  public findByIdempotencyKey(
    ownerId: string,
    key: string,
  ): Promise<Readonly<{
    transaction: Transaction;
    fingerprint: string;
  }> | null> {
    return this.getRepository().findByIdempotencyKey(ownerId, key);
  }
  public listRevisionsForOwner(
    transactionId: string,
    ownerId: string,
  ): Promise<readonly TransactionRevision[]> {
    return this.getRepository().listRevisionsForOwner(transactionId, ownerId);
  }
  public findByIdForOwner(
    id: string,
    ownerId: string,
  ): Promise<Transaction | null> {
    return this.getRepository().findByIdForOwner(id, ownerId);
  }
  public listForAccountOwner(
    accountId: string,
    ownerId: string,
    lifecycle?: TransactionLifecycle,
  ): Promise<readonly Transaction[]> {
    return this.getRepository().listForAccountOwner(
      accountId,
      ownerId,
      lifecycle,
    );
  }

  public sumBalanceEffectsForAccountOwner(
    accountId: string,
    ownerId: string,
  ): Promise<readonly Money[]> {
    return this.getRepository().sumBalanceEffectsForAccountOwner(
      accountId,
      ownerId,
    );
  }

  public listForOwnerBetween(
    ownerId: string,
    from: Date,
    to: Date,
    lifecycle?: TransactionLifecycle,
    filters?: TransactionTimelineFilters,
  ): Promise<readonly Transaction[]> {
    return this.getRepository().listForOwnerBetween(
      ownerId,
      from,
      to,
      lifecycle,
      filters,
    );
  }

  public listWithTimeZoneForOwnerBetween(
    ownerId: string,
    from: Date,
    to: Date,
    lifecycle: 'active',
  ): Promise<readonly TemporalTransaction[]> {
    return this.getRepository().listWithTimeZoneForOwnerBetween(
      ownerId,
      from,
      to,
      lifecycle,
    );
  }

  public save(
    transaction: Transaction,
    expectedVersion: number,
    auditEvent: FinancialAuditEvent,
  ): Promise<boolean> {
    return this.getRepository().save(transaction, expectedVersion, auditEvent);
  }

  public findTransferIdByEntryForOwner(
    transactionId: string,
    ownerId: string,
  ): Promise<string | null> {
    return this.getRepository().findTransferIdByEntryForOwner(
      transactionId,
      ownerId,
    );
  }
  private getRepository(): PrismaTransactionRepository {
    this.repository ??= new PrismaTransactionRepository(this.prisma.get());
    return this.repository;
  }
}
