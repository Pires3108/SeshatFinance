import { readFile } from 'node:fs/promises';

import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { Counterparty } from '@seshat/domain';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createPrismaClient } from '../prisma/create-prisma-client.js';
import { PrismaCounterpartyRepository } from './prisma-counterparty-repository.js';

const ownerId = 'b36bfe2a-f319-49a8-aade-2a536ea3af38';
const otherOwnerId = 'e89b6ad0-7838-4a2c-9a21-c775ea78e22a';
const now = new Date('2026-10-05T12:00:00Z');

function item(id: string, owner = ownerId): Counterparty {
  return Counterparty.create({
    id,
    ownerId: owner,
    name: 'Example',
    type: 'person',
    email: null,
    phone: null,
    document: null,
    notes: null,
    createdAt: now,
  });
}

describe('PrismaCounterpartyRepository', () => {
  let stop: (() => Promise<void>) | undefined;
  let disconnect: (() => Promise<void>) | undefined;
  let repository: PrismaCounterpartyRepository;
  let prisma: ReturnType<typeof createPrismaClient>;

  beforeAll(async (): Promise<void> => {
    const container = await new PostgreSqlContainer('postgres:17-alpine')
      .withDatabase('seshat_test')
      .withUsername('seshat_test')
      .withPassword('synthetic-test-password')
      .start();
    stop = async (): Promise<void> => container.stop().then(() => undefined);
    const client = new Client({
      connectionString: container.getConnectionUri(),
    });
    await client.connect();
    for (const path of [
      '../../prisma/migrations/20260920040000_create_accounts/migration.sql',
      '../../prisma/migrations/20260920133000_create_transactions/migration.sql',
      '../../prisma/migrations/20261005180000_create_counterparties/migration.sql',
    ]) {
      await client.query(
        await readFile(new URL(path, import.meta.url), 'utf8'),
      );
    }
    await client.query(
      await readFile(
        new URL(
          '../../prisma/migrations/20261021180000_counterparty_lifecycle_and_transaction_reference/migration.sql',
          import.meta.url,
        ),
        'utf8',
      ),
    );
    await client.end();
    prisma = createPrismaClient(container.getConnectionUri());
    disconnect = async (): Promise<void> => prisma.$disconnect();
    repository = new PrismaCounterpartyRepository(prisma);
  }, 60_000);

  afterAll(async (): Promise<void> => {
    await disconnect?.();
    await stop?.();
  });

  it('isolates owners and enforces optimistic versioning', async () => {
    const source = item('7c2c7a54-73fe-49a3-b0ea-19034bf22baf');
    await repository.insert(source);
    await expect(
      repository.findByIdForOwner(source.id, otherOwnerId),
    ).resolves.toBeNull();
    await expect(repository.listForOwner(otherOwnerId)).resolves.toEqual([]);
    source.deactivate(new Date('2026-10-05T12:01:00Z'));
    await expect(repository.save(source, 1)).resolves.toBe(true);
    await expect(repository.save(source, 1)).resolves.toBe(false);
    await expect(
      repository.findByIdForOwner(source.id, ownerId),
    ).resolves.toMatchObject({ id: source.id });
  });

  it('does not merge into another owner or inactive target', async () => {
    const source = item('f0ee8a15-69d3-45ca-a172-5f2512ed9fd1');
    const foreign = item('79a44112-9757-4230-8065-0bfd0e078355', otherOwnerId);
    await repository.insert(source);
    await repository.insert(foreign);
    source.mergeInto(foreign.id, new Date('2026-10-05T12:01:00Z'));
    await expect(repository.merge(source, 1, foreign.id)).resolves.toBe(
      'invalid-target',
    );
    expect(
      (await repository.findByIdForOwner(source.id, ownerId))?.toSnapshot()
        .status,
    ).toBe('active');
  });

  it('previews impact and refuses elimination when a merged source depends on the target', async () => {
    const target = item('48e07481-e735-4b5a-a4c4-b36f6e483b7f');
    const source = item('45087122-92d5-46e5-a58f-9ac177542763');
    await repository.insert(target);
    await repository.insert(source);
    source.mergeInto(target.id, new Date('2026-10-05T12:01:00Z'));
    await expect(repository.merge(source, 1, target.id)).resolves.toBe(
      'merged',
    );
    await expect(repository.impact(target.id, ownerId)).resolves.toMatchObject({
      transactionCount: 0,
      mergedSourceCount: 1,
      canEliminate: false,
    });
    target.eliminate(new Date('2026-10-05T12:02:00Z'));
    await expect(repository.eliminate(target, 1)).resolves.toBe('linked');
    expect(
      (await repository.findByIdForOwner(target.id, ownerId))?.toSnapshot()
        .status,
    ).toBe('active');
  });

  it('retains personal fields for 30 days, then scrubs them once and preserves the opaque identity', async () => {
    const id = 'ed3eaf71-7d02-4084-b581-f3d585a71592';
    const entity = Counterparty.create({
      id,
      ownerId,
      name: 'Private Person',
      type: 'person',
      email: 'person@example.com',
      phone: '+5511999999999',
      document: '123456789',
      notes: 'Private note',
      createdAt: now,
    });
    await repository.insert(entity);
    await expect(repository.impact(id, ownerId)).resolves.toMatchObject({
      canEliminate: true,
      transactionCount: 0,
      mergedSourceCount: 0,
    });
    entity.eliminate(new Date('2026-10-05T12:01:00Z'));
    await expect(repository.eliminate(entity, 1)).resolves.toBe('eliminated');
    await expect(
      repository.anonymizeDue(new Date('2026-11-04T12:00:59Z')),
    ).resolves.toBe(0);
    expect(
      (await repository.findByIdForOwner(id, ownerId))?.toSnapshot().email,
    ).toBe('person@example.com');
    await expect(
      repository.anonymizeDue(new Date('2026-11-04T12:01:00Z')),
    ).resolves.toBe(1);
    const snapshot = (
      await repository.findByIdForOwner(id, ownerId)
    )?.toSnapshot();
    expect(snapshot).toMatchObject({
      id,
      ownerId,
      status: 'eliminated',
      name: 'Entidade eliminada',
      email: null,
      phone: null,
      document: null,
      notes: null,
    });
    expect(snapshot?.anonymizedAt).toEqual(new Date('2026-11-04T12:01:00Z'));
    await expect(
      repository.anonymizeDue(new Date('2026-11-05T12:01:00Z')),
    ).resolves.toBe(0);
  });

  it('honors legal hold even when no financial relation exists', async () => {
    const entity = item('1c2a1962-e982-44e6-8830-bc7d8d70c54f');
    await repository.insert(entity);
    await prisma.counterparty.update({
      where: { id: entity.id },
      data: { legalHold: true },
    });
    await expect(repository.impact(entity.id, ownerId)).resolves.toMatchObject({
      legalHold: true,
      canEliminate: false,
    });
    entity.eliminate(new Date('2026-10-05T12:01:00Z'));
    await expect(repository.eliminate(entity, 1)).resolves.toBe('held');
  });

  it('rejects stale elimination after a concurrent lifecycle change', async () => {
    const entity = item('c1976710-b36b-492b-b2ad-11978ec683ce');
    await repository.insert(entity);
    const stale = Counterparty.restore(entity.toSnapshot());
    entity.deactivate(new Date('2026-10-05T12:01:00Z'));
    await expect(repository.save(entity, 1)).resolves.toBe(true);
    stale.eliminate(new Date('2026-10-05T12:02:00Z'));
    await expect(repository.eliminate(stale, 1)).resolves.toBe('conflict');
    expect(
      (await repository.findByIdForOwner(entity.id, ownerId))?.toSnapshot()
        .status,
    ).toBe('inactive');
  });

  it('keeps old links on the merged source and redirects only new links to the active target', async () => {
    const source = item('fe32c2d4-e359-4bbf-88f6-3a9a612ec6e1');
    const target = item('c802cab3-ffbc-4582-8f20-897f83ea9146');
    const accountId = '4e865c50-745e-461f-a5c7-c12ce7a6aa4f';
    await repository.insert(source);
    await repository.insert(target);
    await prisma.$executeRaw`INSERT INTO accounts (id, owner_id, name, type_key, initial_balance_minor_units, currency_code, currency_minor_unit_scale, updated_at) VALUES (${accountId}::uuid, ${ownerId}::uuid, 'Synthetic', 'checking-account', 0, 'BRL', 2, ${now})`;
    const first = '6c3ea905-6c83-4543-b764-8fd30d3a3c8d';
    await prisma.$executeRaw`INSERT INTO transactions (id, owner_id, account_id, kind, amount_minor_units, currency_code, currency_minor_unit_scale, occurred_at, updated_at, counterparty_id) VALUES (${first}::uuid, ${ownerId}::uuid, ${accountId}::uuid, 'expense', 100, 'BRL', 2, ${now}, ${now}, ${source.id}::uuid)`;
    source.mergeInto(target.id, new Date('2026-10-05T12:01:00Z'));
    await expect(repository.merge(source, 1, target.id)).resolves.toBe(
      'merged',
    );
    const second = 'dcf3335e-18f5-4db8-b749-6b1dc89a37d2';
    await prisma.$executeRaw`INSERT INTO transactions (id, owner_id, account_id, kind, amount_minor_units, currency_code, currency_minor_unit_scale, occurred_at, updated_at, counterparty_id) VALUES (${second}::uuid, ${ownerId}::uuid, ${accountId}::uuid, 'expense', 100, 'BRL', 2, ${now}, ${now}, ${source.id}::uuid)`;
    const links = await prisma.transaction.findMany({
      where: { id: { in: [first, second] } },
      orderBy: { id: 'asc' },
    });
    expect(links.find((row) => row.id === first)?.counterpartyId).toBe(
      source.id,
    );
    expect(links.find((row) => row.id === second)?.counterpartyId).toBe(
      target.id,
    );
    await prisma.$executeRaw`UPDATE transactions SET description = 'Edited' WHERE id = ${first}::uuid`;
    expect(
      (await prisma.transaction.findUnique({ where: { id: first } }))
        ?.counterpartyId,
    ).toBe(source.id);
    expect((await repository.impact(source.id, ownerId)).transactionCount).toBe(
      1,
    );
  });

  it('allows free text without creating an entity and rejects inactive or foreign entity links', async () => {
    const accountId = 'cdbe2465-2a57-476d-a243-c68ee06057ac';
    const inactive = item('e5a8aeba-2157-4503-a5f7-f66ddb82876d');
    const foreign = item('8a9e644c-e53b-41b1-8b45-6531448b8499', otherOwnerId);
    await repository.insert(inactive);
    await repository.insert(foreign);
    inactive.deactivate(new Date('2026-10-05T12:01:00Z'));
    await repository.save(inactive, 1);
    await prisma.$executeRaw`INSERT INTO accounts (id, owner_id, name, type_key, initial_balance_minor_units, currency_code, currency_minor_unit_scale, updated_at) VALUES (${accountId}::uuid, ${ownerId}::uuid, 'Synthetic', 'checking-account', 0, 'BRL', 2, ${now})`;
    const freeTextId = '0d54ce43-19f3-4be1-ad30-2c0c228c18f2';
    await prisma.$executeRaw`INSERT INTO transactions (id, owner_id, account_id, kind, amount_minor_units, currency_code, currency_minor_unit_scale, occurred_at, updated_at, counterparty_name) VALUES (${freeTextId}::uuid, ${ownerId}::uuid, ${accountId}::uuid, 'expense', 100, 'BRL', 2, ${now}, ${now}, 'Pessoa avulsa')`;
    expect(
      await prisma.transaction.findUnique({ where: { id: freeTextId } }),
    ).toMatchObject({
      counterpartyId: null,
      counterpartyName: 'Pessoa avulsa',
    });
    await expect(
      prisma.$executeRaw`INSERT INTO transactions (id, owner_id, account_id, kind, amount_minor_units, currency_code, currency_minor_unit_scale, occurred_at, updated_at, counterparty_id) VALUES ('b1ab7626-1563-4903-90b3-983393b843a9', ${ownerId}::uuid, ${accountId}::uuid, 'expense', 100, 'BRL', 2, ${now}, ${now}, ${inactive.id}::uuid)`,
    ).rejects.toThrow();
    await expect(
      prisma.$executeRaw`INSERT INTO transactions (id, owner_id, account_id, kind, amount_minor_units, currency_code, currency_minor_unit_scale, occurred_at, updated_at, counterparty_id) VALUES ('5c8317ed-251a-4933-a004-48f0be21c0c8', ${ownerId}::uuid, ${accountId}::uuid, 'expense', 100, 'BRL', 2, ${now}, ${now}, ${foreign.id}::uuid)`,
    ).rejects.toThrow();
    await expect(
      prisma.$executeRaw`UPDATE transactions SET counterparty_name = NULL, counterparty_id = ${inactive.id}::uuid WHERE id = ${freeTextId}::uuid`,
    ).rejects.toThrow();
    await expect(
      prisma.$executeRaw`UPDATE transactions SET counterparty_name = NULL, counterparty_id = ${foreign.id}::uuid WHERE id = ${freeTextId}::uuid`,
    ).rejects.toThrow();
    expect(
      await prisma.transaction.findUnique({ where: { id: freeTextId } }),
    ).toMatchObject({
      counterpartyId: null,
      counterpartyName: 'Pessoa avulsa',
    });
  });
});
