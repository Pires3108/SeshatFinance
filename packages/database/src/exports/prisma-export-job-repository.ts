import { isDeepStrictEqual } from 'node:util';

import {
  ExportJobValidationError,
  type ExportJob,
  type ExportJobRepository,
} from '@seshat/application';

import { Prisma } from '../generated/prisma/client.js';
import type { PrismaClient } from '../generated/prisma/client.js';

type ExportJobRecord = Awaited<
  ReturnType<PrismaClient['exportJob']['findUnique']>
>;

function toJob(record: NonNullable<ExportJobRecord>): ExportJob {
  return {
    id: record.id,
    actorId: record.actorId,
    idempotencyKey: record.idempotencyKey,
    format: record.format,
    selection: record.selection as ExportJob['selection'],
    filters: record.filters as unknown as ExportJob['filters'],
    status: record.status,
    progress: record.progress,
    storageKey: record.storageKey,
    errorCode: record.errorCode,
    createdAt: record.createdAt,
    expiresAt: record.expiresAt,
    updatedAt: record.updatedAt,
  };
}

function isUniqueConflict(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'P2002'
  );
}

export class PrismaExportJobRepository implements ExportJobRepository {
  public constructor(private readonly client: PrismaClient) {}

  public async claimNext(now: Date): Promise<ExportJob | null> {
    const staleBefore = new Date(now.getTime() - 5 * 60 * 1000);
    const claimed = await this.client.$queryRaw<
      Array<{ id: string }>
    >(Prisma.sql`
      WITH candidate AS (
        SELECT id FROM export_jobs
        WHERE expires_at > ${now}
          AND (status = 'queued' OR (status = 'processing' AND updated_at <= ${staleBefore}))
        ORDER BY created_at, id
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      UPDATE export_jobs AS jobs
      SET status = 'processing', progress = 0, storage_key = NULL, error_code = NULL,
          updated_at = GREATEST(${now}::timestamptz, jobs.updated_at + INTERVAL '1 millisecond')
      FROM candidate WHERE jobs.id = candidate.id
      RETURNING jobs.id
    `);
    const id = claimed[0]?.id;
    if (id === undefined) return null;
    const record = await this.client.exportJob.findUnique({ where: { id } });
    if (record === null) throw new Error('Claimed export job was not found.');
    return toJob(record);
  }

  public async claimExpired(now: Date): Promise<ExportJob | null> {
    const staleBefore = new Date(now.getTime() - 5 * 60 * 1000);
    const claimed = await this.client.$queryRaw<
      Array<{ id: string }>
    >(Prisma.sql`
      WITH candidate AS (
        SELECT id FROM export_jobs
        WHERE expires_at <= ${now}
          AND (status IN ('queued', 'completed', 'failed')
            OR (status = 'processing' AND updated_at <= ${staleBefore}))
        ORDER BY expires_at, id
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      UPDATE export_jobs AS jobs
      SET status = 'processing',
          updated_at = GREATEST(${now}::timestamptz, jobs.updated_at + INTERVAL '1 millisecond')
      FROM candidate WHERE jobs.id = candidate.id
      RETURNING jobs.id
    `);
    const id = claimed[0]?.id;
    if (id === undefined) return null;
    const record = await this.client.exportJob.findUnique({ where: { id } });
    if (record === null) throw new Error('Claimed export job was not found.');
    return toJob(record);
  }

  public async transition(
    job: ExportJob,
    expectedUpdatedAt: Date,
  ): Promise<boolean> {
    if (job.updatedAt.getTime() <= expectedUpdatedAt.getTime())
      throw new Error(
        'Export job transition must advance its fencing timestamp.',
      );
    const result = await this.client.exportJob.updateMany({
      where: {
        id: job.id,
        actorId: job.actorId,
        status: 'processing',
        updatedAt: expectedUpdatedAt,
      },
      data: {
        status: job.status,
        progress: job.progress,
        storageKey: job.storageKey,
        errorCode: job.errorCode,
        updatedAt: job.updatedAt,
      },
    });
    return result.count === 1;
  }

  public async findByIdempotencyKey(
    actorId: string,
    idempotencyKey: string,
  ): Promise<ExportJob | null> {
    const record = await this.client.exportJob.findUnique({
      where: { actorId_idempotencyKey: { actorId, idempotencyKey } },
    });
    return record === null ? null : toJob(record);
  }

  public async create(job: ExportJob): Promise<ExportJob> {
    try {
      const record = await this.client.exportJob.create({
        data: {
          id: job.id,
          actorId: job.actorId,
          idempotencyKey: job.idempotencyKey,
          format: job.format,
          selection: job.selection as Prisma.InputJsonValue,
          filters: job.filters as Prisma.InputJsonValue,
          status: job.status,
          progress: job.progress,
          storageKey: job.storageKey,
          errorCode: job.errorCode,
          createdAt: job.createdAt,
          expiresAt: job.expiresAt,
          updatedAt: job.updatedAt,
        },
      });
      return toJob(record);
    } catch (error) {
      if (!isUniqueConflict(error)) throw error;
      const existing = await this.findByIdempotencyKey(
        job.actorId,
        job.idempotencyKey,
      );
      if (existing !== null) {
        if (
          existing.format !== job.format ||
          existing.selection.zone !== job.selection.zone ||
          !isDeepStrictEqual(existing.filters, job.filters)
        )
          throw new ExportJobValidationError(
            'Idempotency key belongs to another export request.',
          );
        return existing;
      }
      throw error;
    }
  }

  public async getOwned(
    actorId: string,
    jobId: string,
  ): Promise<ExportJob | null> {
    const record = await this.client.exportJob.findFirst({
      where: { id: jobId, actorId },
    });
    return record === null ? null : toJob(record);
  }

  public async update(job: ExportJob): Promise<ExportJob> {
    const result = await this.client.exportJob.updateMany({
      where: { id: job.id, actorId: job.actorId },
      data: {
        status: job.status,
        progress: job.progress,
        storageKey: job.storageKey,
        errorCode: job.errorCode,
        updatedAt: job.updatedAt,
      },
    });
    if (result.count !== 1) throw new Error('Export job was not found.');
    const updated = await this.getOwned(job.actorId, job.id);
    if (updated === null) throw new Error('Export job was not found.');
    return updated;
  }
}
