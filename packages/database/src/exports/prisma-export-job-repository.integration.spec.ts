import { readFile } from 'node:fs/promises';

import { ExportJobValidationError, type ExportJob } from '@seshat/application';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { PrismaClient } from '../generated/prisma/client.js';
import { createPrismaClient } from '../prisma/create-prisma-client.js';
import { PrismaExportJobRepository } from './prisma-export-job-repository.js';

const actorId = '11111111-1111-4111-8111-111111111111';
const foreignActorId = '22222222-2222-4222-8222-222222222222';
const createdAt = new Date('2026-10-07T12:00:00.000Z');

function job(id: string, key: string): ExportJob {
  return {
    id,
    actorId,
    idempotencyKey: key,
    format: 'csv',
    selection: { sets: ['accounts'], zone: 'America/Sao_Paulo' },
    filters: {
      from: null,
      to: null,
      accountIds: [],
      categoryIds: [],
      entityIds: [],
      includeArchived: false,
      includeTrash: false,
      sets: ['accounts'],
    },
    status: 'queued',
    progress: 0,
    storageKey: null,
    errorCode: null,
    createdAt,
    expiresAt: new Date(createdAt.getTime() + 24 * 60 * 60 * 1000),
    updatedAt: createdAt,
  };
}

describe('PrismaExportJobRepository', () => {
  let prisma: PrismaClient | undefined;
  let stop: (() => Promise<void>) | undefined;

  beforeAll(async (): Promise<void> => {
    const container = await new PostgreSqlContainer(
      'postgres:17-alpine',
    ).start();
    stop = async (): Promise<void> => container.stop().then(() => undefined);
    const migration = new Client({
      connectionString: container.getConnectionUri(),
    });
    await migration.connect();
    await migration.query(
      await readFile(
        new URL(
          '../../prisma/migrations/20261007010000_create_export_jobs/migration.sql',
          import.meta.url,
        ),
        'utf8',
      ),
    );
    await migration.end();
    prisma = createPrismaClient(container.getConnectionUri());
  }, 60_000);

  afterAll(async (): Promise<void> => {
    await prisma?.$disconnect();
    await stop?.();
  });

  it('returns one persisted job for concurrent creates with the same actor and key', async () => {
    if (prisma === undefined) throw new Error('Prisma unavailable.');
    const repository = new PrismaExportJobRepository(prisma);
    const first = job('33333333-3333-4333-8333-333333333333', 'same-request');
    const second = job('44444444-4444-4444-8444-444444444444', 'same-request');
    const created = await Promise.all([
      repository.create(first),
      repository.create(second),
    ]);
    expect(created[0]?.id).toBe(created[1]?.id);
    expect(await prisma.exportJob.count()).toBe(1);
    expect(created[0]?.selection).toEqual(first.selection);
    expect(created[0]?.filters).toEqual(first.filters);
    expect(created[0]?.expiresAt).toEqual(first.expiresAt);
    expect(
      (await repository.findByIdempotencyKey(actorId, 'same-request'))?.id,
    ).toBe(created[0]?.id);
    expect(
      await repository.findByIdempotencyKey(foreignActorId, 'same-request'),
    ).toBeNull();
  });

  it('scopes reads and status updates to the owner without replacing frozen inputs', async () => {
    if (prisma === undefined) throw new Error('Prisma unavailable.');
    const repository = new PrismaExportJobRepository(prisma);
    const original = job(
      '55555555-5555-4555-8555-555555555555',
      'status-request',
    );
    await repository.create(original);
    expect(await repository.getOwned(foreignActorId, original.id)).toBeNull();
    await expect(
      repository.update({
        ...original,
        actorId: foreignActorId,
        status: 'completed',
      }),
    ).rejects.toThrow();
    const changed = await repository.update({
      ...original,
      status: 'completed',
      progress: 100,
      storageKey: 'private/export-id',
      updatedAt: new Date('2026-10-07T12:01:00.000Z'),
      selection: { sets: ['transactions'] },
    });
    expect(changed.status).toBe('completed');
    expect(changed.progress).toBe(100);
    expect(changed.storageKey).toBe('private/export-id');
    expect(changed.selection).toEqual(original.selection);
    expect(changed.filters).toEqual(original.filters);
  });

  it('rejects a conflicting concurrent request for the same idempotency key', async () => {
    if (prisma === undefined) throw new Error('Prisma unavailable.');
    const repository = new PrismaExportJobRepository(prisma);
    const original = job(
      '66666666-6666-4666-8666-666666666666',
      'conflicting-request',
    );
    await repository.create(original);
    await expect(
      repository.create({
        ...original,
        id: '77777777-7777-4777-8777-777777777777',
        format: 'json',
      }),
    ).rejects.toBeInstanceOf(ExportJobValidationError);
    expect(
      await prisma.exportJob.count({
        where: { idempotencyKey: 'conflicting-request' },
      }),
    ).toBe(1);
  });
});
