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

  beforeAll(async (): Promise<void> => {
    const container = await new PostgreSqlContainer('postgres:17-alpine')
      .withDatabase('seshat_test')
      .withUsername('seshat_test')
      .withPassword('synthetic-test-password')
      .start();
    stop = async (): Promise<void> => container.stop().then(() => undefined);
    const migration = await readFile(
      new URL(
        '../../prisma/migrations/20261005180000_create_counterparties/migration.sql',
        import.meta.url,
      ),
      'utf8',
    );
    const client = new Client({
      connectionString: container.getConnectionUri(),
    });
    await client.connect();
    await client.query(migration);
    await client.end();
    const prisma = createPrismaClient(container.getConnectionUri());
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
});
