import {
  Account,
  AccountType,
  CivilDate,
  Currency,
  Investment,
  InvestmentType,
  Money,
  type InvestmentEvent,
  type Transaction,
} from '@seshat/domain';
import { describe, expect, it } from 'vitest';

import type { IdempotencyRequest } from '../ports/idempotency.js';
import { InvestmentNotFoundError } from './manage-investment.js';
import {
  ChangeInvestmentEventLifecycleUseCase,
  InvestmentEventAccountUnavailableError,
  InvestmentEventCurrencyMismatchError,
  InvestmentEventNotFoundError,
  InvestmentUnavailableForEventError,
  ListInvestmentEventsUseCase,
  RecordInvestmentEventUseCase,
  type InvestmentEventRepository,
  type InvestmentEventWrite,
  type RecordInvestmentEventCommand,
} from './record-investment-event.js';

const ownerId = 'owner-id';
const brl = Currency.create('BRL', 2);
const now = new Date('2026-11-27T12:00:00.000Z');
const clock = { now: (): Date => now };

function identifiers(): { generate: () => string } {
  let next = 0;
  return { generate: (): string => `id-${String((next += 1))}` };
}

function investment(lifecycle: 'active' | 'archived' = 'active'): Investment {
  const created = Investment.create({
    code: 'PETR4',
    contractedRate: null,
    createdAt: new Date('2026-01-01T12:00:00.000Z'),
    currency: brl,
    id: 'investment-id',
    institution: 'Corretora',
    liquidity: { days: 2, kind: 'd-plus' },
    maturityDate: null,
    name: 'Petrobras PN',
    ownerId,
    startDate: CivilDate.parse('2026-01-01'),
    type: InvestmentType.create('stock'),
  });
  if (lifecycle === 'archived') created.archive(now);
  return created;
}

function account(currency = brl): Account {
  return Account.create({
    color: null,
    createdAt: new Date('2026-01-01T12:00:00.000Z'),
    description: null,
    icon: null,
    id: 'account-id',
    initialBalance: Money.fromDecimal('5000', currency),
    institution: null,
    name: 'Conta corrente',
    ownerId,
    type: AccountType.create('checking'),
  });
}

class MemoryEvents implements InvestmentEventRepository {
  public readonly writes: InvestmentEventWrite[] = [];
  public readonly responses = new Map<string, string>();
  public readonly transactions = new Map<string, Transaction>();
  public readonly events = new Map<string, InvestmentEvent>();

  public findIdempotentResponse(
    request: IdempotencyRequest,
  ): Promise<string | null> {
    return Promise.resolve(this.responses.get(request.key) ?? null);
  }

  public findByIdForOwner(eventId: string): Promise<InvestmentEvent | null> {
    return Promise.resolve(this.events.get(eventId) ?? null);
  }

  public listForInvestment(): Promise<readonly InvestmentEvent[]> {
    return Promise.resolve([...this.events.values()]);
  }

  public recordAtomically(
    request: IdempotencyRequest,
    write: InvestmentEventWrite,
    response: string,
  ): Promise<string> {
    this.writes.push(write);
    this.events.set(write.event.id, write.event);
    if (write.transaction !== null) {
      this.transactions.set(write.transaction.id, write.transaction);
    }
    this.responses.set(request.key, response);
    return Promise.resolve(response);
  }

  public changeAtomically(
    eventId: string,
    _ownerId: string,
    expectedVersion: number,
    build: (
      event: InvestmentEvent,
      transaction: Transaction | null,
    ) => InvestmentEventWrite,
  ): Promise<InvestmentEvent | null> {
    const event = this.events.get(eventId);
    if (event === undefined) return Promise.resolve(null);
    expect(event.version).toBe(expectedVersion);
    const linked =
      event.transactionId === null
        ? null
        : (this.transactions.get(event.transactionId) ?? null);
    const write = build(event, linked);
    this.writes.push(write);
    return Promise.resolve(write.event);
  }
}

function setup(
  options: { investment?: Investment | null; account?: Account | null } = {},
): { events: MemoryEvents; record: RecordInvestmentEventUseCase } {
  const events = new MemoryEvents();
  const found =
    options.investment === undefined ? investment() : options.investment;
  const owned = options.account === undefined ? account() : options.account;
  const record = new RecordInvestmentEventUseCase(
    { findByIdForOwner: () => Promise.resolve(found) },
    { findByIdForOwner: () => Promise.resolve(owned) },
    events,
    clock,
    identifiers(),
  );
  return { events, record };
}

const command = (
  overrides: Partial<RecordInvestmentEventCommand> = {},
): RecordInvestmentEventCommand => ({
  accountId: 'ACCOUNT-ID',
  actorId: ownerId,
  amount: '1500.00',
  idempotencyKey: '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d',
  investmentId: 'investment-id',
  kind: 'contribution',
  occurredAt: new Date('2026-03-10T15:00:00.000Z'),
  quantity: '100',
  timeZone: 'America/Sao_Paulo',
  unitPrice: '15',
  ...overrides,
});

describe('RecordInvestmentEventUseCase (US-055)', () => {
  it('writes an aporte, its account outflow and both audits together', async () => {
    const { events, record } = setup();
    const recorded = await record.execute(command());

    expect(recorded.toSnapshot()).toMatchObject({
      accountId: 'account-id',
      kind: 'contribution',
      quantity: '100',
    });
    const [write] = events.writes;
    expect(write?.transaction?.toSnapshot()).toMatchObject({
      accountId: 'account-id',
      description: 'Aporte em Petrobras PN',
      kind: 'expense',
    });
    expect(write?.transaction?.amount.toDecimal()).toBe('1500.00');
    expect(recorded.transactionId).toBe(write?.transaction?.id);
    expect(
      write?.auditEvents.map((event) => event.toSnapshot().resourceType),
    ).toEqual(['transaction', 'investment-event']);
  });

  it('writes a resgate and an income as account inflows', async () => {
    const { events, record } = setup();
    await record.execute(command({ kind: 'redemption' }));
    await record.execute(
      command({
        idempotencyKey: '1a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d',
        kind: 'dividend',
        quantity: null,
        unitPrice: null,
      }),
    );
    expect(
      events.writes.map((write) => write.transaction?.toSnapshot().kind),
    ).toEqual(['income', 'income']);
  });

  it('records a pre-existing position and fees without an account entry', async () => {
    const { events, record } = setup();
    await record.execute(command({ accountId: null }));
    await record.execute(
      command({
        accountId: null,
        idempotencyKey: '2a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d',
        kind: 'fee',
        quantity: null,
        unitPrice: null,
      }),
    );
    expect(events.writes.map((write) => write.transaction)).toEqual([
      null,
      null,
    ]);
    expect(events.writes[1]?.auditEvents).toHaveLength(1);
  });

  it('replays the stored response for the same key', async () => {
    const { events, record } = setup();
    const first = await record.execute(command());
    const second = await record.execute(command());
    expect(second.toSnapshot()).toEqual(first.toSnapshot());
    expect(events.writes).toHaveLength(1);
  });

  it('rejects missing or inactive investments and unusable accounts', async () => {
    await expect(
      setup({ investment: null }).record.execute(command()),
    ).rejects.toThrow(InvestmentNotFoundError);
    await expect(
      setup({ investment: investment('archived') }).record.execute(command()),
    ).rejects.toThrow(InvestmentUnavailableForEventError);
    await expect(
      setup({ account: null }).record.execute(command()),
    ).rejects.toThrow(InvestmentEventAccountUnavailableError);
    await expect(
      setup({ account: account(Currency.create('USD', 2)) }).record.execute(
        command(),
      ),
    ).rejects.toThrow(InvestmentEventCurrencyMismatchError);
  });
});

describe('investment event lifecycle and listing', () => {
  it('trashes and restores the event with its linked entry', async () => {
    const { events, record } = setup();
    const recorded = await record.execute(command());
    const lifecycle = new ChangeInvestmentEventLifecycleUseCase(
      events,
      clock,
      identifiers(),
    );
    const trashed = await lifecycle.execute({
      action: 'trash',
      actorId: ownerId,
      eventId: recorded.id,
      expectedVersion: 1,
    });
    expect(trashed.lifecycle).toBe('trashed');
    const linked = events.writes[1]?.transaction?.toSnapshot();
    expect(linked?.lifecycle).toBe('trashed');
    expect(
      events.writes[1]?.auditEvents.map((event) => event.toSnapshot().action),
    ).toEqual(['moved-to-trash', 'moved-to-trash']);

    const restored = await lifecycle.execute({
      action: 'restore',
      actorId: ownerId,
      eventId: recorded.id,
      expectedVersion: 2,
    });
    expect(restored.lifecycle).toBe('active');
    expect(events.writes[2]?.transaction?.toSnapshot().lifecycle).toBe(
      'active',
    );
    await expect(
      lifecycle.execute({
        action: 'trash',
        actorId: ownerId,
        eventId: 'missing',
        expectedVersion: 1,
      }),
    ).rejects.toThrow(InvestmentEventNotFoundError);
  });

  it('lists events only for an owned investment', async () => {
    const events = new MemoryEvents();
    await expect(
      new ListInvestmentEventsUseCase(
        { findByIdForOwner: () => Promise.resolve(null) },
        events,
      ).execute({ actorId: ownerId, investmentId: 'investment-id' }),
    ).rejects.toThrow(InvestmentNotFoundError);
    await expect(
      new ListInvestmentEventsUseCase(
        { findByIdForOwner: () => Promise.resolve(investment()) },
        events,
      ).execute({ actorId: ownerId, investmentId: 'investment-id' }),
    ).resolves.toEqual([]);
  });
});
