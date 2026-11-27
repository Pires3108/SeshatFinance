import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';

import {
  ChangeInvestmentEventLifecycleUseCase,
  CreateInvestmentUseCase,
  InvestmentCustodyExceededError,
  InvestmentEventCurrencyMismatchError,
  InvestmentEventVersionConflictError,
  ListInvestmentEventsUseCase,
  RecordInvestmentEventUseCase,
  type RecordInvestmentEventCommand,
} from '@seshat/application';
import {
  Account,
  AccountType,
  Currency,
  FinancialAuditEvent,
  Money,
} from '@seshat/domain';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PrismaAccountRepository } from '../accounts/prisma-account-repository.js';
import type { PrismaClient } from '../generated/prisma/client.js';
import { createPrismaClient } from '../prisma/create-prisma-client.js';
import { PrismaTransactionRepository } from '../transactions/prisma-transaction-repository.js';
import { PrismaInvestmentEventRepository } from './prisma-investment-event-repository.js';
import { PrismaInvestmentRepository } from './prisma-investment-repository.js';

const ownerId = '44444444-4444-4444-8444-444444444444';
const now = new Date('2026-11-27T15:00:00.000Z');
const clock = { now: (): Date => now };
const identifiers = { generate: (): string => randomUUID() };
const brl = Currency.create('BRL', 2);

describe('investment events in PostgreSQL (US-055, RN-073, INV-027)', () => {
  let stop: (() => Promise<void>) | undefined;
  let client: PrismaClient | undefined;
  const accountId = randomUUID();
  const usdAccountId = randomUUID();

  beforeAll(async (): Promise<void> => {
    const container = await new PostgreSqlContainer('postgres:17-alpine')
      .withDatabase('seshat_test')
      .withUsername('seshat_test')
      .withPassword('synthetic-test-password')
      .start();
    stop = async (): Promise<void> => container.stop().then(() => undefined);
    const migrationClient = new Client({
      connectionString: container.getConnectionUri(),
    });
    await migrationClient.connect();
    const migrations = new URL('../../prisma/migrations/', import.meta.url);
    for (const directoryName of (await readdir(migrations)).sort()) {
      if (!/^\d/u.test(directoryName)) continue;
      await migrationClient.query(
        await readFile(
          new URL(`${directoryName}/migration.sql`, migrations),
          'utf8',
        ),
      );
    }
    await migrationClient.end();
    client = createPrismaClient(container.getConnectionUri());
    const accounts = new PrismaAccountRepository(client);
    for (const [id, currency] of [
      [accountId, brl],
      [usdAccountId, Currency.create('USD', 2)],
    ] as const) {
      await accounts.insert(
        Account.create({
          color: null,
          createdAt: new Date('2026-01-01T12:00:00.000Z'),
          description: null,
          icon: null,
          id,
          initialBalance: Money.fromDecimal('10000.00', currency),
          institution: null,
          name: 'Conta corrente',
          ownerId,
          type: AccountType.create('checking-account'),
        }),
        FinancialAuditEvent.create({
          action: 'created',
          actorId: ownerId,
          id: randomUUID(),
          occurredAt: new Date('2026-01-01T12:00:00.000Z'),
          ownerId,
          resourceId: id,
          resourceType: 'account',
        }),
      );
    }
  }, 120_000);

  afterAll(async (): Promise<void> => {
    await client?.$disconnect();
    await stop?.();
  });

  function prisma(): PrismaClient {
    if (client === undefined) throw new Error('PostgreSQL unavailable.');
    return client;
  }

  function useCases(): {
    record: RecordInvestmentEventUseCase;
    lifecycle: ChangeInvestmentEventLifecycleUseCase;
    list: ListInvestmentEventsUseCase;
  } {
    const investments = new PrismaInvestmentRepository(prisma());
    const events = new PrismaInvestmentEventRepository(prisma());
    return {
      lifecycle: new ChangeInvestmentEventLifecycleUseCase(
        events,
        clock,
        identifiers,
      ),
      list: new ListInvestmentEventsUseCase(investments, events),
      record: new RecordInvestmentEventUseCase(
        investments,
        new PrismaAccountRepository(prisma()),
        events,
        clock,
        identifiers,
      ),
    };
  }

  async function createStock(): Promise<string> {
    const investment = await new CreateInvestmentUseCase(
      new PrismaInvestmentRepository(prisma()),
      clock,
      identifiers,
    ).execute({
      actorId: ownerId,
      code: 'PETR4',
      currencyCode: 'BRL',
      currencyMinorUnitScale: 2,
      idempotencyKey: randomUUID(),
      institution: 'Corretora Exemplo',
      liquidity: { days: 2, kind: 'd-plus' },
      name: 'Petrobras PN',
      startDate: '2026-01-02',
      type: 'stock',
    });
    return investment.id;
  }

  const command = (
    investmentId: string,
    overrides: Partial<RecordInvestmentEventCommand> = {},
  ): RecordInvestmentEventCommand => ({
    accountId,
    actorId: ownerId,
    amount: '1500.00',
    idempotencyKey: randomUUID(),
    investmentId,
    kind: 'contribution',
    occurredAt: new Date('2026-03-10T15:00:00.000Z'),
    quantity: '100',
    timeZone: 'America/Sao_Paulo',
    unitPrice: '15',
    ...overrides,
  });

  async function accountBalanceEffect(): Promise<string> {
    const [row] = await prisma().$queryRaw<{ total: string }[]>`
      SELECT COALESCE(SUM(CASE WHEN "kind" = 'income' THEN "amount_minor_units"
        ELSE -"amount_minor_units" END), 0)::text AS "total"
      FROM "transactions"
      WHERE "account_id" = ${accountId}::uuid AND "lifecycle" = 'active'
    `;
    return row?.total ?? '';
  }

  it('writes the aporte and its account outflow in one transaction and replays the key', async () => {
    const investmentId = await createStock();
    const before = await accountBalanceEffect();
    const recordCommand = command(investmentId);
    const recorded = await useCases().record.execute(recordCommand);
    const replayed = await useCases().record.execute(recordCommand);

    expect(replayed.toSnapshot()).toEqual(recorded.toSnapshot());
    expect(BigInt(await accountBalanceEffect())).toBe(BigInt(before) - 150000n);
    const stored = await prisma().investmentEvent.findUniqueOrThrow({
      where: { id: recorded.id },
    });
    expect(stored.quantity?.toFixed()).toBe('100');
    expect(stored.occurredOn.toISOString().slice(0, 10)).toBe('2026-03-10');
    const entry = await prisma().transaction.findUniqueOrThrow({
      where: { id: recorded.transactionId ?? '' },
    });
    expect(entry).toMatchObject({
      kind: 'expense',
      timeZone: 'America/Sao_Paulo',
    });
    const audits = await prisma().financialAuditEvent.findMany({
      where: { resourceId: { in: [recorded.id, entry.id] } },
    });
    expect(audits.map((audit) => audit.resourceType).sort()).toEqual([
      'investment_event',
      'transaction',
    ]);
  });

  it('keeps aportes and resgates out of income and expense, but not income events', async () => {
    const investmentId = await createStock();
    const { record } = useCases();
    const aporte = await record.execute(command(investmentId));
    const dividend = await record.execute(
      command(investmentId, {
        amount: '12.34',
        kind: 'dividend',
        quantity: null,
        unitPrice: null,
      }),
    );
    const transactions = new PrismaTransactionRepository(prisma());
    const listed = await transactions.listWithTimeZoneForOwnerBetween(
      ownerId,
      new Date('2026-03-01T00:00:00.000Z'),
      new Date('2026-04-01T00:00:00.000Z'),
      'active',
    );
    const flags = new Map(
      listed.map((item) => [item.transaction.id, item.investmentMovement]),
    );
    expect(flags.get(aporte.transactionId ?? '')).toBe(true);
    expect(flags.get(dividend.transactionId ?? '')).toBe(false);
    await expect(
      transactions.findInvestmentEventIdByEntryForOwner(
        aporte.transactionId ?? '',
        ownerId,
      ),
    ).resolves.toBe(aporte.id);
  });

  it('rejects a resgate above custody, even backdated, without partial effect', async () => {
    const investmentId = await createStock();
    const { record, list } = useCases();
    await record.execute(command(investmentId));
    const before = await accountBalanceEffect();

    await expect(
      record.execute(
        command(investmentId, { kind: 'redemption', quantity: '101' }),
      ),
    ).rejects.toThrow(InvestmentCustodyExceededError);
    await expect(
      record.execute(
        command(investmentId, {
          kind: 'redemption',
          occurredAt: new Date('2026-03-01T15:00:00.000Z'),
          quantity: '10',
        }),
      ),
    ).rejects.toThrow(InvestmentCustodyExceededError);
    expect(await accountBalanceEffect()).toBe(before);
    expect(await list.execute({ actorId: ownerId, investmentId })).toHaveLength(
      1,
    );

    const resgate = await record.execute(
      command(investmentId, { kind: 'redemption', quantity: '100' }),
    );
    expect(resgate.kind).toBe('redemption');
  });

  it('trashes an event with its account entry and blocks a trash that breaks custody', async () => {
    const investmentId = await createStock();
    const { record, lifecycle } = useCases();
    const aporte = await record.execute(command(investmentId));
    const before = await accountBalanceEffect();

    const trashed = await lifecycle.execute({
      action: 'trash',
      actorId: ownerId,
      eventId: aporte.id,
      expectedVersion: 1,
    });
    expect(trashed.lifecycle).toBe('trashed');
    expect(BigInt(await accountBalanceEffect())).toBe(BigInt(before) + 150000n);
    await expect(
      lifecycle.execute({
        action: 'restore',
        actorId: ownerId,
        eventId: aporte.id,
        expectedVersion: 1,
      }),
    ).rejects.toThrow(InvestmentEventVersionConflictError);
    await lifecycle.execute({
      action: 'restore',
      actorId: ownerId,
      eventId: aporte.id,
      expectedVersion: 2,
    });
    expect(await accountBalanceEffect()).toBe(before);

    await record.execute(
      command(investmentId, { kind: 'redemption', quantity: '40' }),
    );
    await expect(
      lifecycle.execute({
        action: 'trash',
        actorId: ownerId,
        eventId: aporte.id,
        expectedVersion: 3,
      }),
    ).rejects.toThrow(InvestmentCustodyExceededError);
    expect(
      (
        await prisma().investmentEvent.findUniqueOrThrow({
          where: { id: aporte.id },
        })
      ).lifecycle,
    ).toBe('active');
  });

  it('records a position without account and rejects another currency', async () => {
    const investmentId = await createStock();
    const { record } = useCases();
    const before = await accountBalanceEffect();
    const preexisting = await record.execute(
      command(investmentId, { accountId: null }),
    );
    expect(preexisting.transactionId).toBeNull();
    expect(await accountBalanceEffect()).toBe(before);
    await expect(
      record.execute(command(investmentId, { accountId: usdAccountId })),
    ).rejects.toThrow(InvestmentEventCurrencyMismatchError);
  });

  it('enforces the event rules in the schema', async () => {
    const investmentId = await createStock();
    await expect(
      prisma().$executeRaw`
        INSERT INTO "investment_events" ("id", "owner_id", "investment_id",
          "kind", "amount_minor_units", "currency_code",
          "currency_minor_unit_scale", "quantity", "occurred_at", "time_zone",
          "occurred_on", "lifecycle", "created_at", "updated_at", "version")
        VALUES (${randomUUID()}::uuid, ${ownerId}::uuid, ${investmentId}::uuid,
          'fee', 100, 'BRL', 2, 1, ${now}, 'UTC', '2026-03-10', 'active',
          ${now}, ${now}, 1)
      `,
    ).rejects.toThrow(/investment_events_quantity_check/u);
  });
});
