import {
  Account,
  AccountType,
  Currency,
  type FinancialAuditEvent,
  Money,
  type Transfer,
} from '@seshat/domain';
import { describe, expect, it } from 'vitest';

import type { AccountRepository } from '../accounts/create-account.js';
import {
  IdempotencyConflictError,
  InvalidIdempotencyKeyError,
  idempotencyExpiresAt,
  type IdempotencyRequest,
} from '../ports/idempotency.js';
import {
  ChangeOwnedTransferLifecycleUseCase,
  CreateTransferUseCase,
  OwnedTransferNotFoundError,
  TransferAccountUnavailableError,
  TransferCurrencyMismatchError,
  TransferVersionConflictError,
  parseTransferResponse,
  serializeTransferResponse,
  type CreateTransferCommand,
  type IdempotentTransferRecord,
  type TransferLifecycleRepository,
  type TransferRepository,
} from './create-transfer.js';

const ownerId = 'owner-id';
const currency = Currency.create('BRL', 2);

function account(id: string, selectedCurrency = currency): Account {
  return Account.create({
    color: null,
    createdAt: new Date('2026-09-21T10:00:00.000Z'),
    description: null,
    icon: null,
    id,
    initialBalance: Money.fromDecimal('0', selectedCurrency),
    institution: null,
    name: id,
    ownerId,
    type: AccountType.create('checking-account'),
  });
}

function accounts(values: readonly Account[]): AccountRepository {
  return {
    findByIdForOwner: (id, actorId) =>
      Promise.resolve(
        values.find((value) => value.id === id && value.ownerId === actorId) ??
          null,
      ),
    insert: () => Promise.resolve(),
    listForOwner: () => Promise.resolve(values),
    save: () => Promise.resolve(true),
  };
}

const idempotencyKey = '6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b';

function command(
  overrides: Partial<CreateTransferCommand> = {},
): CreateTransferCommand {
  return {
    actorId: ownerId,
    amount: '50.25',
    currencyCode: 'BRL',
    currencyMinorUnitScale: 2,
    description: 'Transferência declarada',
    destinationAccountId: 'destination-id',
    idempotencyKey,
    observations: null,
    occurredAt: new Date('2026-09-21T11:00:00.000Z'),
    sourceAccountId: 'source-id',
    ...overrides,
  };
}

/** In-memory fake mirroring the idempotency contract of the repository port. */
class InMemoryTransferRepository implements TransferRepository {
  public readonly inserted: Transfer[] = [];
  public readonly auditEvents: FinancialAuditEvent[] = [];
  private readonly records = new Map<
    string,
    { payload: string; response: string; expiresAt: Date }
  >();

  public findIdempotentResponse(
    request: IdempotencyRequest,
  ): Promise<string | null> {
    const record = this.records.get(recordKey(request));
    if (record === undefined || record.expiresAt <= request.requestedAt)
      return Promise.resolve(null);
    if (record.payload !== JSON.stringify(request.payload))
      return Promise.reject(new IdempotencyConflictError());
    return Promise.resolve(record.response);
  }

  public async insertAtomically(
    transfer: Transfer,
    auditEvent: FinancialAuditEvent,
    idempotency: IdempotentTransferRecord,
  ): Promise<string> {
    const replayed = await this.findIdempotentResponse(idempotency.request);
    if (replayed !== null) return replayed;
    this.inserted.push(transfer);
    this.auditEvents.push(auditEvent);
    this.records.set(recordKey(idempotency.request), {
      expiresAt: idempotencyExpiresAt(idempotency.request.requestedAt),
      payload: JSON.stringify(idempotency.request.payload),
      response: idempotency.response,
    });
    return idempotency.response;
  }
}

function recordKey(request: IdempotencyRequest): string {
  return `${request.ownerId}:${request.operation}:${request.key}`;
}

function sequence(): { generate: () => string } {
  let next = 0;
  const ids = [
    'transfer-id',
    'source-entry-id',
    'destination-entry-id',
    'audit-event-id',
  ];
  return {
    generate: () => ids[next++ % ids.length] ?? 'unexpected-id',
  };
}

function useCaseWith(
  repository: TransferRepository,
  at = new Date('2026-09-21T12:00:00.000Z'),
  accountValues: readonly Account[] = [
    account('source-id'),
    account('destination-id'),
  ],
): CreateTransferUseCase {
  return new CreateTransferUseCase(
    accounts(accountValues),
    repository,
    { now: () => at },
    sequence(),
  );
}

describe('CreateTransferUseCase', () => {
  it('persists both sides through one atomic repository call', async () => {
    const repository = new InMemoryTransferRepository();

    const result = await useCaseWith(repository).execute(command());

    expect(repository.inserted).toHaveLength(1);
    expect(result.toSnapshot()).toEqual(repository.inserted[0]?.toSnapshot());
    expect(result.toSnapshot()).toMatchObject({
      destination: { id: 'destination-entry-id', kind: 'income' },
      id: 'transfer-id',
      source: { id: 'source-entry-id', kind: 'expense' },
    });
    expect(result.netBalanceEffect().toDecimal()).toBe('0.00');
    expect(repository.auditEvents[0]?.toSnapshot()).toMatchObject({
      action: 'created',
      actorId: ownerId,
      id: 'audit-event-id',
      resourceId: 'transfer-id',
      resourceType: 'transfer',
    });
  });

  it('returns the original transfer for an identical repetition', async () => {
    const repository = new InMemoryTransferRepository();
    const first = await useCaseWith(repository).execute(command());

    const repeated = await useCaseWith(
      repository,
      new Date('2026-09-22T11:59:59.999Z'),
    ).execute(
      command({
        description: '  Transferência declarada  ',
        idempotencyKey: idempotencyKey.toUpperCase(),
      }),
    );

    expect(repository.inserted).toHaveLength(1);
    expect(repository.auditEvents).toHaveLength(1);
    expect(repeated.toSnapshot()).toEqual(first.toSnapshot());
  });

  it('replays the original response even when the accounts changed', async () => {
    const repository = new InMemoryTransferRepository();
    const first = await useCaseWith(repository).execute(command());

    const repeated = await useCaseWith(
      repository,
      new Date('2026-09-21T13:00:00.000Z'),
      [],
    ).execute(command());

    expect(repeated.toSnapshot()).toEqual(first.toSnapshot());
    expect(repository.inserted).toHaveLength(1);
  });

  it('rejects the same key with a different payload without writing', async () => {
    const repository = new InMemoryTransferRepository();
    await useCaseWith(repository).execute(command());

    await expect(
      useCaseWith(repository).execute(command({ amount: '50.26' })),
    ).rejects.toBeInstanceOf(IdempotencyConflictError);
    expect(repository.inserted).toHaveLength(1);
  });

  it('accepts the key again as a new command after 24 hours', async () => {
    const repository = new InMemoryTransferRepository();
    await useCaseWith(repository).execute(command());

    await useCaseWith(repository, new Date('2026-09-22T12:00:00.000Z')).execute(
      command({ amount: '10.00' }),
    );

    expect(repository.inserted).toHaveLength(2);
  });

  it.each(['', 'not-a-uuid', '6f1d2c3b-4a5e-1f60-8a7b-9c0d1e2f3a4b'])(
    'rejects the invalid idempotency key %j before reading accounts',
    async (key) => {
      const repository = new InMemoryTransferRepository();

      await expect(
        useCaseWith(repository).execute(command({ idempotencyKey: key })),
      ).rejects.toBeInstanceOf(InvalidIdempotencyKeyError);
      expect(repository.inserted).toHaveLength(0);
    },
  );

  it('rejects a missing or foreign account', async () => {
    const useCase = useCaseWith(
      new InMemoryTransferRepository(),
      new Date('2026-09-21T12:00:00.000Z'),
      [account('source-id')],
    );

    await expect(useCase.execute(command())).rejects.toBeInstanceOf(
      TransferAccountUnavailableError,
    );
  });

  it('rejects accounts with different currencies before persistence', async () => {
    const repository = new InMemoryTransferRepository();
    const useCase = useCaseWith(
      repository,
      new Date('2026-09-21T12:00:00.000Z'),
      [
        account('source-id'),
        account('destination-id', Currency.create('USD', 2)),
      ],
    );

    await expect(useCase.execute(command())).rejects.toBeInstanceOf(
      TransferCurrencyMismatchError,
    );
    expect(repository.inserted).toHaveLength(0);
  });
});

describe('transfer response codec', () => {
  it('restores the exact recorded snapshot', async () => {
    const transfer = await createTransfer();

    expect(
      parseTransferResponse(serializeTransferResponse(transfer)).toSnapshot(),
    ).toEqual(transfer.toSnapshot());
  });
});

describe('ChangeOwnedTransferLifecycleUseCase', () => {
  it('persists both entries with their independent expected versions', async () => {
    const created = await createTransfer();
    let saved: Transfer | undefined;
    let auditEvent: FinancialAuditEvent | undefined;
    let versions: readonly number[] = [];
    const repository: TransferLifecycleRepository = {
      findByIdForOwner: (id, actorId) =>
        Promise.resolve(
          id === created.id && actorId === created.ownerId ? created : null,
        ),
      saveAtomically: (transfer, sourceVersion, destinationVersion, event) => {
        saved = transfer;
        versions = [sourceVersion, destinationVersion];
        auditEvent = event;
        return Promise.resolve(true);
      },
    };
    const useCase = new ChangeOwnedTransferLifecycleUseCase(
      repository,
      {
        now: () => new Date('2026-09-21T13:00:00.000Z'),
      },
      { generate: () => 'lifecycle-audit-id' },
    );

    const result = await useCase.execute({
      action: 'move-to-trash',
      actorId: ownerId,
      transferId: created.id,
    });

    expect(saved).toBe(result);
    expect(versions).toEqual([1, 1]);
    expect(result.toSnapshot()).toMatchObject({
      destination: { lifecycle: 'trashed', version: 2 },
      source: { lifecycle: 'trashed', version: 2 },
    });
    expect(auditEvent?.toSnapshot()).toMatchObject({
      action: 'moved-to-trash',
      id: 'lifecycle-audit-id',
      resourceId: 'transfer-id',
    });
  });

  it('does not reveal a missing or foreign transfer', async () => {
    const useCase = new ChangeOwnedTransferLifecycleUseCase(
      {
        findByIdForOwner: () => Promise.resolve(null),
        saveAtomically: () => Promise.resolve(true),
      },
      { now: () => new Date('2026-09-21T13:00:00.000Z') },
      { generate: () => 'audit-id' },
    );

    await expect(
      useCase.execute({
        action: 'archive',
        actorId: ownerId,
        transferId: 'unknown-id',
      }),
    ).rejects.toBeInstanceOf(OwnedTransferNotFoundError);
  });

  it('reports an atomic optimistic concurrency conflict', async () => {
    const created = await createTransfer();
    const useCase = new ChangeOwnedTransferLifecycleUseCase(
      {
        findByIdForOwner: () => Promise.resolve(created),
        saveAtomically: () => Promise.resolve(false),
      },
      { now: () => new Date('2026-09-21T13:00:00.000Z') },
      { generate: () => 'audit-id' },
    );

    await expect(
      useCase.execute({
        action: 'archive',
        actorId: ownerId,
        transferId: created.id,
      }),
    ).rejects.toBeInstanceOf(TransferVersionConflictError);
  });
});

async function createTransfer(): Promise<Transfer> {
  return useCaseWith(new InMemoryTransferRepository()).execute(command());
}
