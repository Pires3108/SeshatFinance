import {
  Currency,
  type FinancialAuditEvent,
  Money,
  SYSTEM_AUDIT_ACTOR_ID,
  Transaction,
  type Transfer,
} from '@seshat/domain';
import { describe, expect, it } from 'vitest';

import {
  OwnedTransactionNotFoundError,
  TransactionRequiresTransferMutationError,
  type TransactionFinancialLinkRepository,
  type TransactionRepository,
} from '../transactions/create-transaction.js';
import type { TransferLifecycleRepository } from '../transfers/create-transfer.js';
import {
  EliminateExpiredTrashUseCase,
  EliminateOwnedTrashItemUseCase,
  TrashEliminationBlockedError,
  TrashEliminationConfirmationError,
  TrashEliminator,
  type TrashEliminationRepository,
  type TrashEliminationTarget,
} from './eliminate-from-trash.js';

const ownerId = 'owner-id';
const transactionId = '6f9c1a2b-3d4e-4f50-8a61-7b8c9d0e1f2a';
const now = new Date('2026-11-12T12:00:00.000Z');

function trashed(id = transactionId): Transaction {
  const value = Transaction.create({
    accountId: 'account-id',
    amount: Money.fromDecimal('10.00', Currency.create('BRL', 2)),
    createdAt: new Date('2026-09-01T12:00:00.000Z'),
    description: null,
    id,
    kind: 'expense',
    occurredAt: new Date('2026-09-01T11:00:00.000Z'),
    ownerId,
  });
  value.moveToTrash(new Date('2026-09-02T12:00:00.000Z'));
  return value;
}

class FakeTrash implements TrashEliminationRepository {
  public readonly eliminated: { id: string; audit: FinancialAuditEvent }[] = [];
  public linked = false;
  public cutoff: Date | undefined;
  public constructor(
    private readonly targets: readonly TrashEliminationTarget[] = [],
  ) {}

  public findExpiredTrash(
    cutoff: Date,
  ): Promise<readonly TrashEliminationTarget[]> {
    this.cutoff = cutoff;
    return Promise.resolve(this.targets);
  }

  public hasRetentionLinks(): Promise<boolean> {
    return Promise.resolve(this.linked);
  }

  public eliminateTransaction(
    transaction: Transaction,
    _version: number,
    audit: FinancialAuditEvent,
  ): Promise<boolean> {
    this.eliminated.push({ audit, id: transaction.id });
    return Promise.resolve(true);
  }

  public eliminateTransfer(
    transfer: Transfer,
    _source: number,
    _destination: number,
    audit: FinancialAuditEvent,
  ): Promise<boolean> {
    this.eliminated.push({ audit, id: transfer.id });
    return Promise.resolve(true);
  }
}

function eliminatorWith(
  trash: FakeTrash,
  options: {
    found?: (id: string) => Transaction | null;
    transferId?: string;
  } = {},
): TrashEliminator {
  const transactions = {
    findByIdForOwner: (id: string) =>
      Promise.resolve(options.found ? options.found(id) : trashed(id)),
    findTransferIdByEntryForOwner: () =>
      Promise.resolve(options.transferId ?? null),
  } as unknown as TransactionRepository & TransactionFinancialLinkRepository;
  return new TrashEliminator(
    transactions,
    transactions,
    {
      findByIdForOwner: () => Promise.resolve(null),
    } as unknown as TransferLifecycleRepository,
    trash,
    { now: () => now },
    { generate: () => 'audit-id' },
  );
}

describe('EliminateOwnedTrashItemUseCase (RF-090)', () => {
  it('requires typing the item identifier before eliminating', async () => {
    const trash = new FakeTrash();
    const useCase = new EliminateOwnedTrashItemUseCase(eliminatorWith(trash));

    await expect(
      useCase.execute({
        actorId: ownerId,
        confirmation: 'sim',
        id: transactionId,
        resourceType: 'transaction',
      }),
    ).rejects.toBeInstanceOf(TrashEliminationConfirmationError);
    expect(trash.eliminated).toHaveLength(0);

    await useCase.execute({
      actorId: ownerId,
      confirmation: ` ${transactionId.toUpperCase()} `,
      id: transactionId,
      resourceType: 'transaction',
    });
    expect(trash.eliminated[0]?.audit.toSnapshot()).toMatchObject({
      action: 'eliminated',
      actorId: ownerId,
      ownerId,
      resourceId: transactionId,
      resourceType: 'transaction',
    });
  });

  it('keeps refund or adjustment entries and transfer legs out of reach', async () => {
    const linked = new FakeTrash();
    linked.linked = true;
    const command = {
      actorId: ownerId,
      confirmation: transactionId,
      id: transactionId,
      resourceType: 'transaction' as const,
    };

    await expect(
      new EliminateOwnedTrashItemUseCase(eliminatorWith(linked)).execute(
        command,
      ),
    ).rejects.toBeInstanceOf(TrashEliminationBlockedError);
    await expect(
      new EliminateOwnedTrashItemUseCase(
        eliminatorWith(new FakeTrash(), { transferId: 'transfer-id' }),
      ).execute(command),
    ).rejects.toBeInstanceOf(TransactionRequiresTransferMutationError);
    await expect(
      new EliminateOwnedTrashItemUseCase(
        eliminatorWith(new FakeTrash(), { found: () => null }),
      ).execute(command),
    ).rejects.toBeInstanceOf(OwnedTransactionNotFoundError);
  });
});

describe('EliminateExpiredTrashUseCase (RNF-056)', () => {
  it('eliminates items trashed over 30 days ago as the system and skips conflicts', async () => {
    const trash = new FakeTrash([
      {
        id: 'aaaaaaaa-0000-4000-8000-000000000001',
        ownerId,
        resourceType: 'transaction',
      },
      { id: 'missing-id', ownerId, resourceType: 'transaction' },
    ]);
    const useCase = new EliminateExpiredTrashUseCase(
      trash,
      eliminatorWith(trash, {
        found: (id) => (id === 'missing-id' ? null : trashed(id)),
      }),
      { now: () => now },
    );

    await expect(useCase.execute()).resolves.toEqual({
      eliminated: 1,
      skipped: 1,
    });
    expect(trash.cutoff).toEqual(new Date('2026-10-13T12:00:00.000Z'));
    expect(trash.eliminated[0]?.audit.toSnapshot()).toMatchObject({
      action: 'eliminated',
      actorId: SYSTEM_AUDIT_ACTOR_ID,
      ownerId,
    });
  });
});
