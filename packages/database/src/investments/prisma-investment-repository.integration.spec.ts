import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';

import {
  ChangeInvestmentLifecycleUseCase,
  CreateInvestmentUseCase,
  InvestmentVersionConflictError,
  ListInvestmentsUseCase,
  UpdateInvestmentUseCase,
  type CreateInvestmentCommand,
} from '@seshat/application';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { PrismaClient } from '../generated/prisma/client.js';
import { createPrismaClient } from '../prisma/create-prisma-client.js';
import { PrismaInvestmentRepository } from './prisma-investment-repository.js';

const ownerId = '33333333-3333-4333-8333-333333333333';
const otherId = '22222222-2222-4222-8222-222222222222';
const now = new Date('2026-11-27T15:00:00.000Z');
const clock = { now: (): Date => now };
const identifiers = { generate: (): string => randomUUID() };

const command = (
  overrides: Partial<CreateInvestmentCommand> = {},
): CreateInvestmentCommand => ({
  actorId: ownerId,
  contractedRate: { indexer: 'ipca', percent: '6.5' },
  currencyCode: 'BRL',
  currencyMinorUnitScale: 2,
  idempotencyKey: randomUUID(),
  institution: 'Tesouro Nacional',
  liquidity: { days: 1, kind: 'd-plus' },
  maturityDate: '2035-05-15',
  name: 'Tesouro IPCA+ 2035',
  startDate: '2026-02-01',
  type: 'treasury-direct',
  ...overrides,
});

describe('investments in PostgreSQL (US-054, RF-051, RF-052)', () => {
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
  }, 120_000);

  afterAll(async (): Promise<void> => {
    await client?.$disconnect();
    await stop?.();
  });

  function prisma(): PrismaClient {
    if (client === undefined) throw new Error('PostgreSQL unavailable.');
    return client;
  }

  const repository = (): PrismaInvestmentRepository =>
    new PrismaInvestmentRepository(prisma());

  it('persists every field, replays the key and audits the creation', async () => {
    const create = new CreateInvestmentUseCase(
      repository(),
      clock,
      identifiers,
    );
    const input = command();
    const created = await create.execute(input);
    const replayed = await create.execute(input);

    expect(replayed.id).toBe(created.id);
    const stored = await repository().findByIdForOwner(created.id, ownerId);
    expect(stored?.toSnapshot()).toEqual(created.toSnapshot());
    expect(stored?.toSnapshot()).toMatchObject({
      contractedRate: { indexer: 'ipca', percent: '6.5' },
      liquidity: { days: 1, kind: 'd-plus' },
      maturityDate: '2035-05-15',
      startDate: '2026-02-01',
      type: 'treasury-direct',
    });
    expect(await prisma().investment.count({ where: { id: created.id } })).toBe(
      1,
    );
    expect(
      await prisma().financialAuditEvent.count({
        where: { resourceId: created.id, resourceType: 'investment' },
      }),
    ).toBe(1);
  });

  it('never records a transaction when registering an investment', async () => {
    const before = await prisma().transaction.count();
    await new CreateInvestmentUseCase(repository(), clock, identifiers).execute(
      command({ name: 'Sem efeito' }),
    );
    expect(await prisma().transaction.count()).toBe(before);
  });

  it('lists only the owner investments', async () => {
    const create = new CreateInvestmentUseCase(
      repository(),
      clock,
      identifiers,
    );
    const foreign = await create.execute(
      command({ actorId: otherId, name: 'Alheio' }),
    );
    const listed = await new ListInvestmentsUseCase(repository()).execute(
      ownerId,
    );
    expect(listed.map((item) => item.id)).not.toContain(foreign.id);
    expect(await repository().findByIdForOwner(foreign.id, ownerId)).toBeNull();
  });

  it('updates and changes lifecycle with optimistic versions', async () => {
    const repo = repository();
    const created = await new CreateInvestmentUseCase(
      repo,
      clock,
      identifiers,
    ).execute(command({ name: 'Versão' }));
    const update = new UpdateInvestmentUseCase(repo, clock, identifiers);
    const updated = await update.execute({
      ...command({ name: 'Versão 2' }),
      expectedVersion: 1,
      investmentId: created.id,
    });
    expect(updated.version).toBe(2);
    await expect(
      update.execute({
        ...command({ name: 'Atrasado' }),
        expectedVersion: 1,
        investmentId: created.id,
      }),
    ).rejects.toBeInstanceOf(InvestmentVersionConflictError);

    const lifecycle = new ChangeInvestmentLifecycleUseCase(
      repo,
      clock,
      identifiers,
    );
    const trashed = await lifecycle.execute({
      action: 'trash',
      actorId: ownerId,
      expectedVersion: 2,
      investmentId: created.id,
    });
    expect(trashed.lifecycle).toBe('trashed');
    expect(
      await lifecycle
        .execute({
          action: 'trash',
          actorId: otherId,
          expectedVersion: 3,
          investmentId: created.id,
        })
        .catch((error: unknown) => error),
    ).toBeInstanceOf(Error);
  });

  it('rejects rows that break the descriptive constraints', async () => {
    await expect(
      prisma().$executeRaw`
        INSERT INTO "investments" (
          "id", "owner_id", "type", "institution", "name",
          "currency_code", "currency_minor_unit_scale", "start_date",
          "liquidity_kind", "lifecycle", "created_at", "updated_at", "version",
          "rate_indexer", "rate_percent"
        ) VALUES (
          ${randomUUID()}::uuid, ${ownerId}::uuid, 'cdb', 'Banco', 'CDB',
          'BRL', 2, '2026-01-01', 'daily', 'active', now(), now(), 1,
          'cdi', '1,10'
        )
      `,
    ).rejects.toThrow();
  });
});
