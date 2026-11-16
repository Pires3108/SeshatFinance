import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';

import {
  CreateLoanUseCase,
  EMPTY_HOLIDAY_SETTINGS,
  GetLoanUseCase,
  IdempotencyConflictError,
  LoanCalendar,
  LoanCounterpartyUnavailableError,
  LoanEventInFutureError,
  LoanNotFoundError,
  RecordLoanEventUseCase,
  RenegotiateLoanUseCase,
  type CreateLoanCommand,
  type LoanEventInput,
} from '@seshat/application';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import {
  LoanPaymentExcessUnclassifiedError,
  LoanClosedError,
} from '@seshat/domain';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { PrismaClient } from '../generated/prisma/client.js';
import { createPrismaClient } from '../prisma/create-prisma-client.js';
import { PrismaLoanRepository } from './prisma-loan-repository.js';

const ownerId = '99999999-9999-4999-8999-999999999999';
const otherId = '88888888-8888-4888-8888-888888888888';
// 15/03/2026 at noon in São Paulo.
const now = new Date('2026-03-15T15:00:00.000Z');

const calendar = new LoanCalendar(
  {
    changeTimeZone: () => Promise.resolve(null),
    findById: () => Promise.resolve(null),
    upsert: (profile) => Promise.resolve(profile),
  },
  {
    addDeclared: () => Promise.resolve(),
    findForOwner: () => Promise.resolve(EMPTY_HOLIDAY_SETTINGS),
    removeDeclared: () => Promise.resolve(false),
    saveLocation: () => Promise.resolve(),
  },
  { now: () => now },
);
const identifiers = { generate: (): string => randomUUID() };

const terms = {
  businessDayRule: 'none',
  contractedOn: '2026-01-10',
  count: 1,
  currencyCode: 'BRL',
  currencyMinorUnitScale: 2,
  description: 'Empréstimo ao Pedro',
  direction: 'receivable',
  firstDueOn: '2026-02-10',
  principal: '100.00',
  profile: 'constant',
  rate: null,
} as const;

describe('loans in PostgreSQL (US-047, INV-048)', () => {
  let stop: (() => Promise<void>) | undefined;
  let client: PrismaClient | undefined;

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
    for (const directory of (await readdir(migrations)).sort()) {
      if (!/^\d/u.test(directory)) continue;
      await migrationClient.query(
        await readFile(
          new URL(`${directory}/migration.sql`, migrations),
          'utf8',
        ),
      );
    }
    await migrationClient.end();
    client = createPrismaClient(container.getConnectionUri());
  }, 120_000);

  afterAll(async (): Promise<void> => {
    await client?.$disconnect();
    await stop?.();
  });

  function repository(): PrismaLoanRepository {
    if (client === undefined) throw new Error('PostgreSQL unavailable.');
    return new PrismaLoanRepository(client);
  }

  async function create(
    change: Partial<CreateLoanCommand> = {},
  ): Promise<string> {
    const view = await new CreateLoanUseCase(
      repository(),
      { findByIdForOwner: () => Promise.resolve(null) },
      calendar,
      identifiers,
    ).execute({
      ...terms,
      actorId: ownerId,
      idempotencyKey: randomUUID(),
      ...change,
    });
    return view.loan.id;
  }

  const record = (
    loanId: string,
    event: LoanEventInput,
    key = randomUUID(),
    actorId = ownerId,
  ): ReturnType<RecordLoanEventUseCase['execute']> =>
    new RecordLoanEventUseCase(repository(), calendar, identifiers).execute({
      actorId,
      event,
      idempotencyKey: key,
      loanId,
    });

  const pending = async (loanId: string): Promise<string> =>
    (
      await new GetLoanUseCase(repository(), calendar).execute({
        actorId: ownerId,
        loanId,
      })
    ).state.pending.toDecimal();

  it('stores the frozen schedule and keeps the remaining balance after a partial payment', async () => {
    const loanId = await create({
      count: 3,
      principal: '1000.00',
      rate: {
        method: 'compound',
        percentPerPeriod: '1',
        periodicity: 'monthly',
      },
    });
    const view = await new GetLoanUseCase(repository(), calendar).execute({
      actorId: ownerId,
      loanId,
    });
    expect(view.loan.installments.map((item) => item.amount.amount)).toEqual([
      '340.02',
      '340.02',
      '340.03',
    ]);

    const single = await create();
    await record(single, {
      amount: '40.00',
      kind: 'payment',
      occurredOn: '2026-03-01',
    });
    expect(await pending(single)).toBe('60.00');
  });

  it('replays the same key once and rejects a changed payload', async () => {
    const loanId = await create();
    const key = randomUUID();
    const payment = {
      amount: '10.00',
      kind: 'payment',
      occurredOn: '2026-03-01',
    } as const;

    await record(loanId, payment, key);
    await record(loanId, payment, key);
    await expect(
      record(loanId, { ...payment, amount: '11.00' }, key),
    ).rejects.toThrow(IdempotencyConflictError);
    expect(await pending(loanId)).toBe('90.00');
    await expect(client?.loanEvent.count({ where: { loanId } })).resolves.toBe(
      1,
    );
  });

  it('serializes concurrent payments so each changes the balance exactly once', async () => {
    const loanId = await create();
    await Promise.all(
      [1, 2, 3, 4].map(() =>
        record(loanId, {
          amount: '5.00',
          kind: 'payment',
          occurredOn: '2026-03-01',
        }),
      ),
    );

    expect(await pending(loanId)).toBe('80.00');
    const sequences = await client?.loanEvent.findMany({
      orderBy: { sequence: 'asc' },
      select: { sequence: true },
      where: { loanId },
    });
    expect(sequences?.map((row) => row.sequence)).toEqual([1, 2, 3, 4]);
  });

  it('corrects a payment with an auditable reversal and recalculates once', async () => {
    const loanId = await create();
    const wrong = await record(loanId, {
      amount: '45.00',
      kind: 'payment',
      occurredOn: '2026-03-01',
    });
    const wrongId = wrong.events[0]?.id ?? '';
    await record(loanId, {
      kind: 'reversal',
      reason: 'Valor digitado errado',
      reversedEventId: wrongId,
    });
    await record(loanId, {
      amount: '40.00',
      kind: 'payment',
      occurredOn: '2026-03-01',
    });

    expect(await pending(loanId)).toBe('60.00');
    await expect(client?.loanEvent.count({ where: { loanId } })).resolves.toBe(
      3,
    );
    await expect(
      client?.financialAuditEvent.count({
        where: { resourceId: loanId, resourceType: 'loan' },
      }),
    ).resolves.toBe(4);
  });

  it('refuses an unclassified excess without writing', async () => {
    const loanId = await create({ count: 2, firstDueOn: '2026-03-10' });

    await expect(
      record(loanId, {
        amount: '60.00',
        kind: 'payment',
        occurredOn: '2026-03-10',
      }),
    ).rejects.toThrow(LoanPaymentExcessUnclassifiedError);
    await expect(client?.loanEvent.count({ where: { loanId } })).resolves.toBe(
      0,
    );
  });

  it('renegotiates into a new linked loan and keeps the old one as renegotiated', async () => {
    const loanId = await create({ count: 2 });
    const renewed = await new RenegotiateLoanUseCase(
      repository(),
      calendar,
      identifiers,
    ).execute({
      actorId: ownerId,
      idempotencyKey: randomUUID(),
      loanId,
      occurredOn: '2026-03-01',
      terms: {
        ...terms,
        count: 4,
        firstDueOn: '2026-04-10',
        principal: '100.00',
      },
    });

    expect(renewed.loan.toSnapshot().renegotiatedFromId).toBe(loanId);
    const old = await new GetLoanUseCase(repository(), calendar).execute({
      actorId: ownerId,
      loanId,
    });
    expect(old.state.status).toBe('renegotiated');
    expect(old.state.pending.toDecimal()).toBe('0.00');
    await expect(
      record(loanId, {
        amount: '1.00',
        kind: 'payment',
        occurredOn: '2026-03-02',
      }),
    ).rejects.toThrow(LoanClosedError);
  });

  it('refuses future events and unavailable counterparties without writing', async () => {
    const loanId = await create();

    await expect(
      record(loanId, {
        amount: '1.00',
        kind: 'payment',
        occurredOn: '2026-03-16',
      }),
    ).rejects.toThrow(LoanEventInFutureError);
    await expect(
      create({ counterpartyId: '77777777-7777-4777-8777-777777777777' }),
    ).rejects.toThrow(LoanCounterpartyUnavailableError);
    await expect(client?.loanEvent.count({ where: { loanId } })).resolves.toBe(
      0,
    );
  });

  it('hides loans of another holder', async () => {
    const loanId = await create();

    await expect(
      new GetLoanUseCase(repository(), calendar).execute({
        actorId: otherId,
        loanId,
      }),
    ).rejects.toThrow(LoanNotFoundError);
    await expect(
      record(
        loanId,
        { amount: '1.00', kind: 'payment', occurredOn: '2026-03-01' },
        randomUUID(),
        otherId,
      ),
    ).rejects.toThrow(LoanNotFoundError);
  });

  it('keeps schedules and events immutable in the database', async () => {
    if (client === undefined) throw new Error('PostgreSQL unavailable.');
    await expect(
      client.$executeRaw`UPDATE "loan_events" SET "reason" = 'x'`,
    ).rejects.toThrow(/immutable/u);
    await expect(
      client.$executeRaw`DELETE FROM "loan_installments"`,
    ).rejects.toThrow(/immutable/u);
  });
});
