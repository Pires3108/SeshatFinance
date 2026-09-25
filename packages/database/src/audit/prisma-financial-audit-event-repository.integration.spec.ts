import { readFile } from 'node:fs/promises';

import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { FinancialAuditEvent } from '@seshat/domain';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { PrismaClient } from '../generated/prisma/client.js';
import { createPrismaClient } from '../prisma/create-prisma-client.js';
import { PrismaFinancialAuditEventRepository } from './prisma-financial-audit-event-repository.js';

const eventId = '11111111-1111-4111-8111-111111111111';
const ownerId = '22222222-2222-4222-8222-222222222222';
const actorId = '33333333-3333-4333-8333-333333333333';
const resourceId = '44444444-4444-4444-8444-444444444444';

describe('PrismaFinancialAuditEventRepository', () => {
  let stop: (() => Promise<void>) | undefined;
  let disconnect: (() => Promise<void>) | undefined;
  let client: PrismaClient | undefined;
  let repository: PrismaFinancialAuditEventRepository | undefined;

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
    await migrationClient.query(
      await readFile(
        new URL(
          '../../prisma/migrations/20260921210000_create_financial_audit_events/migration.sql',
          import.meta.url,
        ),
        'utf8',
      ),
    );
    await migrationClient.end();
    const prisma = createPrismaClient(container.getConnectionUri());
    client = prisma;
    disconnect = async (): Promise<void> => prisma.$disconnect();
    repository = new PrismaFinancialAuditEventRepository(prisma);
    await repository.insert(auditEvent());
  }, 60_000);

  afterAll(async (): Promise<void> => {
    await disconnect?.();
    await stop?.();
  });

  it('persists the immutable event metadata', async () => {
    if (client === undefined || repository === undefined) throw unavailable();

    const record = await client.financialAuditEvent.findUniqueOrThrow({
      where: { id: eventId },
    });

    expect(Object.keys(record).sort()).toEqual([
      'action',
      'actorId',
      'id',
      'occurredAt',
      'ownerId',
      'resourceId',
      'resourceType',
    ]);
    expect(record).toMatchObject({
      action: 'moved_to_trash',
      actorId,
      ownerId,
      resourceId,
      resourceType: 'transaction',
    });
  });

  it('rejects update, deletion, and truncation at the database boundary', async () => {
    if (client === undefined) throw unavailable();

    await expect(
      client.financialAuditEvent.update({
        data: { action: 'updated' },
        where: { id: eventId },
      }),
    ).rejects.toThrow(/append-only/);
    await expect(
      client.financialAuditEvent.delete({ where: { id: eventId } }),
    ).rejects.toThrow(/append-only/);
    await expect(
      client.$executeRawUnsafe('TRUNCATE TABLE "financial_audit_events"'),
    ).rejects.toThrow(/append-only/);
    await expect(client.financialAuditEvent.count()).resolves.toBe(1);
  });
});

function auditEvent(): FinancialAuditEvent {
  return FinancialAuditEvent.create({
    action: 'moved-to-trash',
    actorId,
    id: eventId,
    occurredAt: new Date('2026-09-21T18:00:00.000Z'),
    ownerId,
    resourceId,
    resourceType: 'transaction',
  });
}

function unavailable(): Error {
  return new Error('Financial audit persistence is unavailable.');
}
