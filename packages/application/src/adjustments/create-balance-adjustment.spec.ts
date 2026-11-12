import {
  Account,
  AccountType,
  BalanceAdjustment,
  Currency,
  type FinancialAuditEvent,
  Money,
  Transaction,
} from '@seshat/domain';
import { describe, expect, it } from 'vitest';

import type { AccountRepository } from '../accounts/create-account.js';
import {
  IdempotencyConflictError,
  IDEMPOTENCY_RETENTION_MILLISECONDS,
  InvalidIdempotencyKeyError,
  type IdempotencyRequest,
} from '../ports/idempotency.js';
import type { TransactionRepository } from '../transactions/create-transaction.js';
import {
  BalanceAdjustmentAccountUnavailableError,
  BalanceAdjustmentBalanceConflictError,
  CREATE_BALANCE_ADJUSTMENT_OPERATION,
  CreateBalanceAdjustmentUseCase,
  parseBalanceAdjustmentResponse,
  serializeBalanceAdjustmentResponse,
  type BalanceAdjustmentRepository,
  type CreateBalanceAdjustmentCommand,
  type IdempotentBalanceAdjustmentRecord,
} from './create-balance-adjustment.js';

const currency = Currency.create('BRL', 2);
const ownerId = 'owner-id';
const key = '3f2b8c1d-4e5a-4b6c-8d7e-9f0a1b2c3d4e';

function accountRepository(value: Account | null): AccountRepository {
  return {
    findByIdForOwner: () => Promise.resolve(value),
    insert: () => Promise.resolve(),
    listForOwner: () => Promise.resolve(value === null ? [] : [value]),
    save: () => Promise.resolve(true),
  };
}

function transactionRepository(
  values: readonly Transaction[],
): TransactionRepository {
  return {
    findByIdForOwner: () => Promise.resolve(null),
    insert: () => Promise.resolve(),
    listForAccountOwner: () => Promise.resolve(values),
    save: () => Promise.resolve(true),
  };
}

function activeAccount(): Account {
  return Account.create({
    color: null,
    createdAt: new Date('2026-09-21T10:00:00.000Z'),
    description: null,
    icon: null,
    id: 'account-id',
    initialBalance: Money.fromDecimal('100.00', currency),
    institution: null,
    name: 'Conta',
    ownerId,
    type: AccountType.create('checking-account'),
  });
}

type StoredRecord = Readonly<{
  expiresAt: number;
  payload: string;
  response: string;
}>;

/** Simulates the idempotency table and the atomic write. */
class InMemoryBalanceAdjustmentRepository implements BalanceAdjustmentRepository {
  public readonly inserted: BalanceAdjustment[] = [];
  public readonly auditEvents: FinancialAuditEvent[] = [];
  public readonly requests: IdempotencyRequest[] = [];
  public balanceChanged = false;
  private readonly records = new Map<string, StoredRecord>();

  public findIdempotentResponse(
    request: IdempotencyRequest,
  ): Promise<string | null> {
    const record = this.records.get(recordKey(request));
    if (
      record === undefined ||
      record.expiresAt <= request.requestedAt.getTime()
    ) {
      return Promise.resolve(null);
    }
    if (record.payload !== JSON.stringify(request.payload)) {
      return Promise.reject(new IdempotencyConflictError());
    }
    return Promise.resolve(record.response);
  }

  public async insertAtomically(
    adjustment: BalanceAdjustment,
    auditEvent: FinancialAuditEvent,
    idempotency: IdempotentBalanceAdjustmentRecord,
  ): Promise<string | null> {
    const replayed = await this.findIdempotentResponse(idempotency.request);
    if (replayed !== null) return replayed;
    if (this.balanceChanged) return null;
    this.inserted.push(adjustment);
    this.auditEvents.push(auditEvent);
    this.requests.push(idempotency.request);
    this.records.set(recordKey(idempotency.request), {
      expiresAt:
        idempotency.request.requestedAt.getTime() +
        IDEMPOTENCY_RETENTION_MILLISECONDS,
      payload: JSON.stringify(idempotency.request.payload),
      response: idempotency.response,
    });
    return idempotency.response;
  }
}

function recordKey(request: IdempotencyRequest): string {
  return `${request.ownerId}:${request.operation}:${request.key}`;
}

function command(
  overrides: Partial<CreateBalanceAdjustmentCommand> = {},
): CreateBalanceAdjustmentCommand {
  return {
    accountId: 'account-id',
    actorId: ownerId,
    idempotencyKey: key,
    justification: 'Conferência do extrato',
    occurredAt: new Date('2026-09-21T11:00:00.000Z'),
    reportedBalance: '92.50',
    ...overrides,
  };
}

function useCaseWith(
  options: {
    account?: Account | null;
    adjustments?: BalanceAdjustmentRepository;
    now?: () => Date;
    transactions?: readonly Transaction[];
  } = {},
): CreateBalanceAdjustmentUseCase {
  let sequence = 0;
  return new CreateBalanceAdjustmentUseCase(
    accountRepository(
      options.account === undefined ? activeAccount() : options.account,
    ),
    transactionRepository(options.transactions ?? []),
    options.adjustments ?? new InMemoryBalanceAdjustmentRepository(),
    { now: options.now ?? (() => new Date('2026-09-21T12:00:00.000Z')) },
    {
      generate: () => {
        sequence += 1;
        return `id-${String(sequence)}`;
      },
    },
  );
}

describe('CreateBalanceAdjustmentUseCase', () => {
  it('records the calculated previous balance, the audit event and the idempotency payload', async () => {
    const existing = Transaction.create({
      accountId: 'account-id',
      amount: Money.fromDecimal('15.00', currency),
      createdAt: new Date('2026-09-21T10:00:00.000Z'),
      description: null,
      id: 'existing-id',
      kind: 'expense',
      occurredAt: new Date('2026-09-21T10:00:00.000Z'),
      ownerId,
    });
    const adjustments = new InMemoryBalanceAdjustmentRepository();
    const useCase = useCaseWith({ adjustments, transactions: [existing] });

    const result = await useCase.execute(command());

    expect(result.difference.toDecimal()).toBe('7.50');
    expect(result.previousBalance.toDecimal()).toBe('85.00');
    expect(result.reportedBalance.toDecimal()).toBe('92.50');
    expect(result.transactionKind).toBe('income');
    expect(adjustments.inserted).toHaveLength(1);
    expect(adjustments.auditEvents[0]?.toSnapshot()).toMatchObject({
      action: 'created',
      actorId: ownerId,
      resourceId: result.id,
      resourceType: 'balance-adjustment',
    });
    expect(adjustments.requests[0]).toEqual({
      key,
      operation: CREATE_BALANCE_ADJUSTMENT_OPERATION,
      ownerId,
      payload: {
        accountId: 'account-id',
        justification: 'Conferência do extrato',
        occurredAt: '2026-09-21T11:00:00.000Z',
        reportedBalance: '92.5',
      },
      requestedAt: new Date('2026-09-21T12:00:00.000Z'),
    });
  });

  it('replays the original adjustment for an equivalent repetition without writing again', async () => {
    const adjustments = new InMemoryBalanceAdjustmentRepository();
    const useCase = useCaseWith({ adjustments });
    const first = await useCase.execute(command());

    const second = await useCase.execute(
      command({
        idempotencyKey: key.toUpperCase(),
        justification: '  Conferência do extrato  ',
        reportedBalance: '092.500',
      }),
    );

    expect(adjustments.inserted).toHaveLength(1);
    expect(second.id).toBe(first.id);
    expect(second.difference.toDecimal()).toBe(first.difference.toDecimal());
  });

  it('replays even after the balance moved and the account was archived', async () => {
    const adjustments = new InMemoryBalanceAdjustmentRepository();
    const first = await useCaseWith({ adjustments }).execute(command());
    const archived = activeAccount();
    archived.archive(new Date('2026-09-21T12:30:00.000Z'));

    const replayed = await useCaseWith({
      account: archived,
      adjustments,
    }).execute(command());

    expect(replayed.id).toBe(first.id);
    expect(adjustments.inserted).toHaveLength(1);
  });

  it('rejects the same key with a different reported balance', async () => {
    const adjustments = new InMemoryBalanceAdjustmentRepository();
    const useCase = useCaseWith({ adjustments });
    await useCase.execute(command());

    await expect(
      useCase.execute(command({ reportedBalance: '93.00' })),
    ).rejects.toBeInstanceOf(IdempotencyConflictError);
    expect(adjustments.inserted).toHaveLength(1);
  });

  it('treats the key as new after the 24 hour replay window', async () => {
    const adjustments = new InMemoryBalanceAdjustmentRepository();
    await useCaseWith({ adjustments }).execute(command());

    await useCaseWith({
      adjustments,
      now: () => new Date('2026-09-22T12:00:00.000Z'),
    }).execute(command());

    expect(adjustments.inserted).toHaveLength(2);
  });

  it.each(['', 'not-a-uuid', '6ba7b810-9dad-11d1-80b4-00c04fd430c8'])(
    'rejects the invalid idempotency key %j before reading the account',
    async (idempotencyKey) => {
      const adjustments = new InMemoryBalanceAdjustmentRepository();
      await expect(
        useCaseWith({ adjustments }).execute(command({ idempotencyKey })),
      ).rejects.toBeInstanceOf(InvalidIdempotencyKeyError);
      expect(adjustments.inserted).toHaveLength(0);
    },
  );

  it('rejects a missing or foreign account', async () => {
    await expect(
      useCaseWith({ account: null }).execute(command()),
    ).rejects.toBeInstanceOf(BalanceAdjustmentAccountUnavailableError);
  });

  it('rejects a reported balance equal to the current balance without writing', async () => {
    const adjustments = new InMemoryBalanceAdjustmentRepository();
    await expect(
      useCaseWith({ adjustments }).execute(
        command({ reportedBalance: '100.00' }),
      ),
    ).rejects.toThrow('non-zero balance difference');
    expect(adjustments.inserted).toHaveLength(0);
  });

  it('reports a conflict when the balance changes before the atomic insert', async () => {
    const adjustments = new InMemoryBalanceAdjustmentRepository();
    adjustments.balanceChanged = true;

    await expect(
      useCaseWith({ adjustments }).execute(
        command({ reportedBalance: '110.00' }),
      ),
    ).rejects.toBeInstanceOf(BalanceAdjustmentBalanceConflictError);
  });

  it('round-trips the stored response', () => {
    const adjustment = BalanceAdjustment.create({
      accountId: 'account-id',
      createdAt: new Date('2026-09-21T12:00:00.000Z'),
      id: 'adjustment-id',
      justification: 'Conferência',
      occurredAt: new Date('2026-09-21T11:00:00.000Z'),
      ownerId,
      previousBalance: Money.fromDecimal('100.00', currency),
      reportedBalance: Money.fromDecimal('95.50', currency),
      transactionId: 'transaction-id',
    });

    const parsed = parseBalanceAdjustmentResponse(
      serializeBalanceAdjustmentResponse(adjustment),
    );

    expect(parsed).toMatchObject({
      accountId: 'account-id',
      id: 'adjustment-id',
      transactionId: 'transaction-id',
      transactionKind: 'expense',
    });
    expect(parsed.difference.toDecimal()).toBe('-4.50');
    expect(parsed.difference.currency.equals(currency)).toBe(true);
    expect(parsed.createdAt).toEqual(new Date('2026-09-21T12:00:00.000Z'));
  });
});
