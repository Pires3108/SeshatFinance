import type { Clock } from '../ports/clock.js';
import type { IdentifierGenerator } from '../ports/identifier-generator.js';
import type { ExportFilters, ExportSelection } from './export-contract.js';

export const EXPORT_JOB_TTL_MS = 24 * 60 * 60 * 1000;
export const EXPORT_SIGNED_URL_TTL_MS = 10 * 60 * 1000;

export type ExportJobStatus =
  'queued' | 'processing' | 'completed' | 'failed' | 'expired';
export type ExportFormat = 'json' | 'csv' | 'xlsx';
export type ExportJob = Readonly<{
  id: string;
  actorId: string;
  idempotencyKey: string;
  format: ExportFormat;
  selection: ExportSelection;
  filters: ExportFilters;
  status: ExportJobStatus;
  progress: number;
  storageKey: string | null;
  errorCode: string | null;
  createdAt: Date;
  expiresAt: Date;
  updatedAt: Date;
}>;

export type CreateExportJobCommand = Readonly<{
  actorId: string;
  idempotencyKey: string;
  format: ExportFormat;
  selection: ExportSelection;
}>;

export interface ExportJobRepository {
  findByIdempotencyKey(
    actorId: string,
    idempotencyKey: string,
  ): Promise<ExportJob | null>;
  create(job: ExportJob): Promise<ExportJob>;
  getOwned(actorId: string, jobId: string): Promise<ExportJob | null>;
  update(job: ExportJob): Promise<ExportJob>;
}

export interface ExportAuthorizationPort {
  assertCanExport(
    actorId: string,
    filters: ExportFilters,
    zone: string,
  ): Promise<void>;
}

export interface PrivateExportStorage {
  put(key: string, content: Uint8Array, contentType: string): Promise<void>;
  delete(key: string): Promise<void>;
  createSignedDownloadUrl(key: string, expiresAt: Date): Promise<string>;
}

export class ExportJobValidationError extends Error {}
export class ExportJobNotFoundError extends Error {}
export class ExportJobForbiddenError extends Error {}
export class ExportJobExpiredError extends Error {}

function assertActorId(actorId: string): void {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      actorId,
    )
  )
    throw new ExportJobValidationError('Authenticated actor is invalid.');
}
function assertIdempotencyKey(key: string): void {
  if (!/^[\x21-\x7e]{8,128}$/.test(key))
    throw new ExportJobValidationError('Idempotency key is invalid.');
}

export class CreateExportJobUseCase {
  public constructor(
    private readonly repository: ExportJobRepository,
    private readonly authorization: ExportAuthorizationPort,
    private readonly clock: Clock,
    private readonly identifiers: IdentifierGenerator,
    private readonly parseSelection: (
      selection: ExportSelection,
    ) => Readonly<{ filters: ExportFilters }>,
  ) {}

  public async execute(command: CreateExportJobCommand): Promise<ExportJob> {
    assertActorId(command.actorId);
    assertIdempotencyKey(command.idempotencyKey);
    if (!['json', 'csv', 'xlsx'].includes(command.format))
      throw new ExportJobValidationError('Export format is invalid.');
    const { filters } = this.parseSelection(command.selection);
    await this.authorization.assertCanExport(
      command.actorId,
      filters,
      command.selection.zone as string,
    );
    const existing = await this.repository.findByIdempotencyKey(
      command.actorId,
      command.idempotencyKey,
    );
    if (existing !== null) {
      if (
        existing.format !== command.format ||
        existing.selection.zone !== command.selection.zone ||
        JSON.stringify(existing.filters) !== JSON.stringify(filters)
      )
        throw new ExportJobValidationError(
          'Idempotency key belongs to another export request.',
        );
      return existing;
    }
    const now = this.clock.now();
    const job: ExportJob = {
      id: this.identifiers.generate(),
      actorId: command.actorId,
      idempotencyKey: command.idempotencyKey,
      format: command.format,
      selection: command.selection,
      filters,
      status: 'queued',
      progress: 0,
      storageKey: null,
      errorCode: null,
      createdAt: now,
      expiresAt: new Date(now.getTime() + EXPORT_JOB_TTL_MS),
      updatedAt: now,
    };
    return this.repository.create(job);
  }
}

export class GetExportDownloadUseCase {
  public constructor(
    private readonly repository: ExportJobRepository,
    private readonly authorization: ExportAuthorizationPort,
    private readonly storage: PrivateExportStorage,
    private readonly clock: Clock,
  ) {}

  public async execute(actorId: string, jobId: string): Promise<string> {
    assertActorId(actorId);
    const job = await this.repository.getOwned(actorId, jobId);
    if (job === null)
      throw new ExportJobNotFoundError('Export job was not found.');
    await this.authorization.assertCanExport(
      actorId,
      job.filters,
      job.selection.zone as string,
    );
    const now = this.clock.now();
    if (job.expiresAt.getTime() <= now.getTime() || job.status === 'expired') {
      if (job.storageKey !== null) await this.storage.delete(job.storageKey);
      await this.repository.update({
        ...job,
        status: 'expired',
        storageKey: null,
        updatedAt: now,
      });
      throw new ExportJobExpiredError('Export has expired.');
    }
    if (job.status !== 'completed' || job.storageKey === null)
      throw new ExportJobValidationError('Export is not ready for download.');
    return this.storage.createSignedDownloadUrl(
      job.storageKey,
      new Date(
        Math.min(
          job.expiresAt.getTime(),
          now.getTime() + EXPORT_SIGNED_URL_TTL_MS,
        ),
      ),
    );
  }
}

export class GetExportJobStatusUseCase {
  public constructor(private readonly repository: ExportJobRepository) {}

  public async execute(actorId: string, jobId: string): Promise<ExportJob> {
    assertActorId(actorId);
    const job = await this.repository.getOwned(actorId, jobId);
    if (job === null)
      throw new ExportJobNotFoundError('Export job was not found.');
    return job;
  }
}

export type ExportWorkerJob = Readonly<{
  id: string;
  actorId: string;
  format: ExportFormat;
  selection: ExportSelection;
  filters: ExportFilters;
  expiresAt: Date;
}>;

export interface ExportJobProcessor {
  process(job: ExportWorkerJob): Promise<void>;
}

export class ExpireExportJobsUseCase {
  public constructor(
    private readonly repository: ExportJobRepository,
    private readonly storage: PrivateExportStorage,
    private readonly clock: Clock,
  ) {}

  public async expire(job: ExportJob): Promise<ExportJob> {
    const now = this.clock.now();
    if (job.expiresAt.getTime() > now.getTime() && job.status !== 'expired')
      return job;
    if (job.storageKey !== null) await this.storage.delete(job.storageKey);
    return this.repository.update({
      ...job,
      status: 'expired',
      storageKey: null,
      updatedAt: now,
    });
  }
}
