import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';

import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { FinancialAuditEvent } from '@seshat/domain';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { PrismaClient } from '../generated/prisma/client.js';
import { createPrismaClient } from '../prisma/create-prisma-client.js';
import {
  configureFinancialAuditCorrelation,
  insertFinancialAuditEvent,
  PrismaFinancialAuditEventRepository,
} from './prisma-financial-audit-event-repository.js';

const chainMigration = '20261112120000_financial_audit_hash_chain';
const legacyOwner = '0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a0a';
const otherOwner = '0b0b0b0b-0b0b-4b0b-8b0b-0b0b0b0b0b0b';
const concurrentOwner = '0c0c0c0c-0c0c-4c0c-8c0c-0c0c0c0c0c0c';
const resourceId = '0d0d0d0d-0d0d-4d0d-8d0d-0d0d0d0d0d0d';

function event(ownerId: string, at: string): FinancialAuditEvent {
  return FinancialAuditEvent.create({
    action: 'created',
    actorId: ownerId,
    id: randomUUID(),
    occurredAt: new Date(at),
    ownerId,
    resourceId,
    resourceType: 'transaction',
  });
}

describe('financial audit hash chain (US-035, ADR-036)', () => {
  let stop: (() => Promise<void>) | undefined;
  let connectionUri = '';
  let prisma: PrismaClient;
  let trail: PrismaFinancialAuditEventRepository;

  beforeAll(async (): Promise<void> => {
    const container = await new PostgreSqlContainer('postgres:17-alpine')
      .withDatabase('seshat_test')
      .withUsername('seshat_test')
      .withPassword('synthetic-test-password')
      .start();
    stop = async (): Promise<void> => container.stop().then(() => undefined);
    connectionUri = container.getConnectionUri();
    const client = new Client({ connectionString: connectionUri });
    await client.connect();
    const migrations = new URL('../../prisma/migrations/', import.meta.url);
    const names = (await readdir(migrations, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    const apply = async (name: string): Promise<void> => {
      await client.query(
        await readFile(new URL(`${name}/migration.sql`, migrations), 'utf8'),
      );
    };
    for (const name of names.filter((name) => name < chainMigration)) {
      await apply(name);
    }
    // A trail recorded before the chain existed, out of insertion order.
    for (const [owner, at] of [
      [legacyOwner, '2026-09-21T12:00:02.000Z'],
      [legacyOwner, '2026-09-21T12:00:01.000Z'],
      [otherOwner, '2026-09-21T12:00:00.000Z'],
      [legacyOwner, '2026-09-21T12:00:03.000Z'],
    ] as const) {
      await client.query(
        `INSERT INTO financial_audit_events
           (id, owner_id, actor_id, action, resource_type, resource_id, occurred_at)
         VALUES ($1, $2, $2, 'created', 'transaction', $3, $4)`,
        [randomUUID(), owner, resourceId, at],
      );
    }
    for (const name of names.filter((name) => name >= chainMigration)) {
      await apply(name);
    }
    await client.end();
    prisma = createPrismaClient(connectionUri);
    trail = new PrismaFinancialAuditEventRepository(prisma);
  }, 120_000);

  afterAll(async (): Promise<void> => {
    configureFinancialAuditCorrelation(() => undefined);
    await prisma.$disconnect();
    await stop?.();
  });

  it('backfills the existing trail per owner in occurrence order', async () => {
    const entries = await trail.listForOwner(legacyOwner, { limit: 100 });
    expect(entries.map((entry) => entry.sequence)).toEqual([1n, 2n, 3n]);
    expect(entries.map((entry) => entry.occurredAt.toISOString())).toEqual([
      '2026-09-21T12:00:01.000Z',
      '2026-09-21T12:00:02.000Z',
      '2026-09-21T12:00:03.000Z',
    ]);
    expect(entries[0]?.previousHash).toBe('0'.repeat(64));
    expect(entries[1]?.previousHash).toBe(entries[0]?.hash);
    await expect(trail.verifyChainForOwner(legacyOwner)).resolves.toEqual({
      checkedEvents: 3n,
      firstInvalidSequence: null,
    });
    await expect(trail.verifyChainForOwner(otherOwner)).resolves.toEqual({
      checkedEvents: 1n,
      firstInvalidSequence: null,
    });
  });

  it('links new events and records the request correlation id', async () => {
    const correlationId = '5f0e1d2c-3b4a-4987-8a6b-5c4d3e2f1a0b';
    configureFinancialAuditCorrelation(() => correlationId);
    await prisma.$transaction(async (client) => {
      await insertFinancialAuditEvent(
        client,
        event(legacyOwner, '2026-09-21T12:00:04.000Z'),
      );
    });
    configureFinancialAuditCorrelation(() => 'not-a-uuid');
    await insertFinancialAuditEvent(
      prisma,
      event(legacyOwner, '2026-09-21T12:00:05.000Z'),
    );
    configureFinancialAuditCorrelation(() => undefined);

    const entries = await trail.listForOwner(legacyOwner, {
      afterSequence: 3n,
      limit: 100,
    });
    expect(entries.map((entry) => entry.sequence)).toEqual([4n, 5n]);
    expect(entries[0]).toMatchObject({
      correlationId,
      result: 'succeeded',
      errorCode: null,
    });
    expect(entries[1]?.correlationId).toBeNull();
    await expect(trail.verifyChainForOwner(legacyOwner)).resolves.toEqual({
      checkedEvents: 5n,
      firstInvalidSequence: null,
    });
  });

  it('serializes concurrent appends of one owner without gaps or forks', async () => {
    await Promise.all(
      Array.from({ length: 10 }, (_, index) =>
        prisma.$transaction(async (client) => {
          await insertFinancialAuditEvent(
            client,
            event(
              concurrentOwner,
              `2026-09-21T13:00:${String(index).padStart(2, '0')}.000Z`,
            ),
          );
        }),
      ),
    );

    const entries = await trail.listForOwner(concurrentOwner, { limit: 100 });
    expect(entries.map((entry) => entry.sequence)).toEqual(
      Array.from({ length: 10 }, (_, index) => BigInt(index + 1)),
    );
    expect(new Set(entries.map((entry) => entry.previousHash)).size).toBe(10);
    await expect(trail.verifyChainForOwner(concurrentOwner)).resolves.toEqual({
      checkedEvents: 10n,
      firstInvalidSequence: null,
    });
  });

  it('exposes only the owner trail and the allowlisted fields', async () => {
    const entries = await trail.listForOwner(otherOwner, { limit: 100 });
    expect(entries).toHaveLength(1);
    expect(Object.keys(entries[0] ?? {}).sort()).toEqual([
      'action',
      'actorId',
      'correlationId',
      'errorCode',
      'hash',
      'id',
      'occurredAt',
      'previousHash',
      'resourceId',
      'resourceType',
      'result',
      'sequence',
    ]);
    await expect(
      trail.listForOwner(randomUUID(), { limit: 100 }),
    ).resolves.toEqual([]);
  });

  it('keeps rejecting updates and detects a row altered behind the trigger', async () => {
    const client = new Client({ connectionString: connectionUri });
    await client.connect();
    try {
      await expect(
        client.query(
          `UPDATE financial_audit_events SET resource_id = $1
           WHERE owner_id = $2 AND owner_sequence = 2`,
          [randomUUID(), legacyOwner],
        ),
      ).rejects.toThrow('append-only');

      await client.query('BEGIN');
      await client.query(
        'ALTER TABLE financial_audit_events DISABLE TRIGGER financial_audit_events_reject_update_or_delete',
      );
      await client.query(
        `UPDATE financial_audit_events SET resource_id = $1
         WHERE owner_id = $2 AND owner_sequence = 2`,
        [randomUUID(), legacyOwner],
      );
      await client.query(
        'ALTER TABLE financial_audit_events ENABLE TRIGGER financial_audit_events_reject_update_or_delete',
      );
      await client.query('COMMIT');
    } finally {
      await client.end();
    }

    await expect(trail.verifyChainForOwner(legacyOwner)).resolves.toEqual({
      checkedEvents: 2n,
      firstInvalidSequence: 2n,
    });
    await expect(trail.verifyChainForOwner(otherOwner)).resolves.toEqual({
      checkedEvents: 1n,
      firstInvalidSequence: null,
    });
  });
});
