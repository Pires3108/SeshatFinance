import { describe, expect, it, vi } from 'vitest';
import type { ExportJob } from '@seshat/application';
import {
  CreateExportJobUseCase,
  GetExportDownloadUseCase,
  GetExportJobStatusUseCase,
  parseExportSelection,
} from '@seshat/application';
import type { FastifyRequest } from 'fastify';

import { ExportController } from './export.controller.js';

const actor = { id: '11111111-1111-4111-8111-111111111111' };
const job: ExportJob = {
  id: '22222222-2222-4222-8222-222222222222',
  actorId: actor.id,
  idempotencyKey: 'export-1234',
  format: 'json',
  selection: { sets: ['accounts'], zone: 'UTC' },
  filters: parseExportSelection({ sets: ['accounts'], zone: 'UTC' }).filters,
  status: 'completed',
  progress: 100,
  storageKey: 'private/exports/job',
  errorCode: null,
  createdAt: new Date('2026-10-07T12:00:00.000Z'),
  expiresAt: new Date('2026-10-08T12:00:00.000Z'),
  updatedAt: new Date('2026-10-07T12:01:00.000Z'),
};

describe('ExportController', () => {
  it('passes the authenticated actor and selection to job creation', async () => {
    const create = {
      execute: vi.fn().mockResolvedValue(job),
    } as unknown as CreateExportJobUseCase;
    const status = {} as GetExportJobStatusUseCase;
    const download = {} as GetExportDownloadUseCase;
    const request = {} as FastifyRequest;
    const actors = { get: vi.fn().mockReturnValue(actor) };
    const controller = new ExportController(
      create,
      status,
      download,
      actors as never,
    );

    const result = await controller.create(request, {
      format: 'json',
      idempotencyKey: 'export-1234',
      selection: { sets: ['accounts'], zone: 'UTC' },
    });

    expect(create.execute).toHaveBeenCalledWith({
      actorId: actor.id,
      format: 'json',
      idempotencyKey: 'export-1234',
      selection: { sets: ['accounts'], zone: 'UTC' },
    });
    expect(result.downloadAvailable).toBe(true);
  });

  it('reuses the authenticated actor for status and private download', async () => {
    const create = {} as CreateExportJobUseCase;
    const status = {
      execute: vi.fn().mockResolvedValue(job),
    } as unknown as GetExportJobStatusUseCase;
    const download = {
      execute: vi.fn().mockResolvedValue('https://private.test/signed'),
    } as unknown as GetExportDownloadUseCase;
    const request = {} as FastifyRequest;
    const actors = { get: vi.fn().mockReturnValue(actor) };
    const controller = new ExportController(
      create,
      status,
      download,
      actors as never,
    );

    expect((await controller.status(request, job.id)).status).toBe('completed');
    expect(await controller.download(request, job.id)).toEqual({
      url: 'https://private.test/signed',
    });
    expect(status.execute).toHaveBeenCalledWith(actor.id, job.id);
    expect(download.execute).toHaveBeenCalledWith(actor.id, job.id);
  });
});
