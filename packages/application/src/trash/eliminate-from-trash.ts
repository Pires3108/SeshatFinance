import { assertNotCardSettlementEntry } from '../transactions/create-transaction.js';
import {
  FinancialAuditEvent,
  SYSTEM_AUDIT_ACTOR_ID,
  type Transaction,
  type Transfer,
} from '@seshat/domain';

import type { Clock } from '../ports/clock.js';
import type { IdentifierGenerator } from '../ports/identifier-generator.js';
import {
  OwnedTransactionNotFoundError,
  TransactionRequiresTransferMutationError,
  TransactionVersionConflictError,
  type TransactionFinancialLinkRepository,
  type TransactionRepository,
} from '../transactions/create-transaction.js';
import {
  OwnedTransferNotFoundError,
  TransferVersionConflictError,
  type TransferLifecycleRepository,
} from '../transfers/create-transfer.js';

/** Days an item stays restorable in the trash before elimination (RNF-056). */
export const TRASH_RETENTION_DAYS = 30;
const dayMilliseconds = 24 * 60 * 60 * 1000;

export type TrashEliminationTarget = Readonly<{
  resourceType: 'transaction' | 'transfer';
  id: string;
  ownerId: string;
}>;

export interface TrashEliminationRepository {
  /**
   * Eligible items trashed at or before the cutoff, oldest first: standalone
   * transactions without refund or adjustment links, and transfer pairs.
   */
  findExpiredTrash(
    cutoff: Date,
    limit: number,
  ): Promise<readonly TrashEliminationTarget[]>;
  /** True when a refund or balance adjustment keeps the entry in history. */
  hasRetentionLinks(transactionId: string, ownerId: string): Promise<boolean>;
  /**
   * Marks the trashed transaction eliminated and appends the audit event
   * atomically. Returns false when the version or state no longer matches.
   */
  eliminateTransaction(
    transaction: Transaction,
    expectedVersion: number,
    auditEvent: FinancialAuditEvent,
  ): Promise<boolean>;
  eliminateTransfer(
    transfer: Transfer,
    expectedSourceVersion: number,
    expectedDestinationVersion: number,
    auditEvent: FinancialAuditEvent,
  ): Promise<boolean>;
}

/** The typed confirmation did not match the item being eliminated. */
export class TrashEliminationConfirmationError extends Error {
  public constructor() {
    super('Permanent elimination requires typing the item identifier.');
    this.name = 'TrashEliminationConfirmationError';
  }
}

/** A refund or adjustment link keeps the entry in the financial history. */
export class TrashEliminationBlockedError extends Error {
  public constructor() {
    super('Linked refunds or adjustments keep this entry in history.');
    this.name = 'TrashEliminationBlockedError';
  }
}

/** Shared elimination rules for the owner action and the retention job. */
export class TrashEliminator {
  public constructor(
    private readonly transactions: TransactionRepository,
    private readonly links: TransactionFinancialLinkRepository,
    private readonly transfers: TransferLifecycleRepository,
    private readonly trash: TrashEliminationRepository,
    private readonly clock: Clock,
    private readonly identifiers: IdentifierGenerator,
  ) {}

  public async eliminateTransaction(
    transactionId: string,
    ownerId: string,
    actorId: string,
  ): Promise<void> {
    const transaction = await this.transactions.findByIdForOwner(
      transactionId,
      ownerId,
    );
    if (transaction === null) throw new OwnedTransactionNotFoundError();
    const transferId = await this.links.findTransferIdByEntryForOwner(
      transaction.id,
      ownerId,
    );
    if (transferId !== null) {
      throw new TransactionRequiresTransferMutationError(transferId);
    }
    await assertNotCardSettlementEntry(this.links, transaction.id, ownerId);
    if (await this.trash.hasRetentionLinks(transaction.id, ownerId)) {
      throw new TrashEliminationBlockedError();
    }
    const expectedVersion = transaction.toSnapshot().version;
    const at = this.clock.now();
    transaction.eliminate(at);
    const saved = await this.trash.eliminateTransaction(
      transaction,
      expectedVersion,
      this.auditEvent(actorId, ownerId, transaction.id, 'transaction', at),
    );
    if (!saved) throw new TransactionVersionConflictError();
  }

  public async eliminateTransfer(
    transferId: string,
    ownerId: string,
    actorId: string,
  ): Promise<void> {
    const transfer = await this.transfers.findByIdForOwner(transferId, ownerId);
    if (transfer === null) throw new OwnedTransferNotFoundError();
    const before = transfer.toSnapshot();
    const at = this.clock.now();
    transfer.eliminate(at);
    const saved = await this.trash.eliminateTransfer(
      transfer,
      before.source.version,
      before.destination.version,
      this.auditEvent(actorId, ownerId, transfer.id, 'transfer', at),
    );
    if (!saved) throw new TransferVersionConflictError();
  }

  private auditEvent(
    actorId: string,
    ownerId: string,
    resourceId: string,
    resourceType: 'transaction' | 'transfer',
    at: Date,
  ): FinancialAuditEvent {
    return FinancialAuditEvent.create({
      action: 'eliminated',
      actorId,
      id: this.identifiers.generate(),
      occurredAt: at,
      ownerId,
      resourceId,
      resourceType,
    });
  }
}

/** Owner action with reinforced confirmation (RF-090). */
export class EliminateOwnedTrashItemUseCase {
  public constructor(private readonly eliminator: TrashEliminator) {}

  public async execute(command: {
    actorId: string;
    resourceType: 'transaction' | 'transfer';
    id: string;
    confirmation: string;
  }): Promise<void> {
    if (
      command.confirmation.trim().toLowerCase() !== command.id.toLowerCase()
    ) {
      throw new TrashEliminationConfirmationError();
    }
    if (command.resourceType === 'transfer') {
      await this.eliminator.eliminateTransfer(
        command.id,
        command.actorId,
        command.actorId,
      );
      return;
    }
    await this.eliminator.eliminateTransaction(
      command.id,
      command.actorId,
      command.actorId,
    );
  }
}

export type TrashRetentionResult = Readonly<{
  eliminated: number;
  skipped: number;
}>;

/**
 * Retention job (RNF-056): eliminates eligible items trashed more than 30
 * days ago, audited as the system actor. A conflicting item is skipped and
 * retried on the next run.
 */
export class EliminateExpiredTrashUseCase {
  public constructor(
    private readonly trash: TrashEliminationRepository,
    private readonly eliminator: TrashEliminator,
    private readonly clock: Clock,
    private readonly batchSize = 100,
  ) {}

  public async execute(): Promise<TrashRetentionResult> {
    const cutoff = new Date(
      this.clock.now().getTime() - TRASH_RETENTION_DAYS * dayMilliseconds,
    );
    const targets = await this.trash.findExpiredTrash(cutoff, this.batchSize);
    let eliminated = 0;
    for (const target of targets) {
      try {
        if (target.resourceType === 'transfer') {
          await this.eliminator.eliminateTransfer(
            target.id,
            target.ownerId,
            SYSTEM_AUDIT_ACTOR_ID,
          );
        } else {
          await this.eliminator.eliminateTransaction(
            target.id,
            target.ownerId,
            SYSTEM_AUDIT_ACTOR_ID,
          );
        }
        eliminated += 1;
      } catch {
        // Changed concurrently (restored, linked or edited); next run retries.
      }
    }
    return { eliminated, skipped: targets.length - eliminated };
  }
}
