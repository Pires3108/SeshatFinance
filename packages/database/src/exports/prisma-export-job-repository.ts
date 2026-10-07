import { isDeepStrictEqual } from 'node:util';

import {
  ExportJobValidationError,
  type ExportJob,
  type ExportJobRepository,
} from '@seshat/application';

import type { Prisma } from '../generated/prisma/client.js';
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
