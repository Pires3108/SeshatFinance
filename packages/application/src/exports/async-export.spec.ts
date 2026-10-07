import { describe, expect, it } from 'vitest';
import { parseExportSelection } from './export-contract.js';
import {
  CreateExportJobUseCase,
  ExportJobExpiredError,
  ExportJobValidationError,
  GetExportDownloadUseCase,
  type ExportJob,
  type ExportJobRepository,
  type PrivateExportStorage,
} from './async-export.js';
import type { Clock } from '../ports/clock.js';
import type { IdentifierGenerator } from '../ports/identifier-generator.js';

const actor = '11111111-1111-4111-8111-111111111111';
const at = new Date('2026-10-07T12:00:00.000Z');
class Repo implements ExportJobRepository {
  jobs = new Map<string, ExportJob>();
  async findByIdempotencyKey(a: string, k: string) {
    return (
      [...this.jobs.values()].find(
        (j) => j.actorId === a && j.idempotencyKey === k,
      ) ?? null
    );
  }
  async create(j: ExportJob) {
    this.jobs.set(j.id, j);
    return j;
  }
  async getOwned(a: string, id: string) {
    const j = this.jobs.get(id);
    return j?.actorId === a ? j : null;
  }
  async update(j: ExportJob) {
    this.jobs.set(j.id, j);
    return j;
  }
}
class Store implements PrivateExportStorage {
  deleted: string[] = [];
  async put() {}
  async delete(k: string) {
    this.deleted.push(k);
  }
  async createSignedDownloadUrl(k: string) {
    return `https://private.test/${k}`;
  }
}
const clock: Clock = { now: () => at };
const ids: IdentifierGenerator = {
  generate: () => '22222222-2222-4222-8222-222222222222',
};

describe('async export jobs', () => {
  it('creates an authorized idempotent job with a frozen expiry', async () => {
    const repo = new Repo();
    const auth = { assertCanExport: async () => undefined };
    const useCase = new CreateExportJobUseCase(
      repo,
      auth,
      clock,
      ids,
      parseExportSelection,
    );
    const command = {
      actorId: actor,
      idempotencyKey: 'export-request-1',
      format: 'json' as const,
      selection: { sets: ['accounts'], zone: 'UTC' },
    };
    const first = await useCase.execute(command);
    const second = await useCase.execute(command);
    expect(second).toEqual(first);
    expect(first.status).toBe('queued');
    expect(first.progress).toBe(0);
    expect(first.expiresAt.toISOString()).toBe('2026-10-08T12:00:00.000Z');
  });
  it('revalidates authorization and rejects a changed idempotent request', async () => {
    const repo = new Repo();
    let allowed = true;
    const useCase = new CreateExportJobUseCase(
      repo,
      {
        assertCanExport: async () => {
          if (!allowed) throw new Error('revoked');
        },
      },
      clock,
      ids,
      parseExportSelection,
    );
    const command = {
      actorId: actor,
      idempotencyKey: 'export-request-2',
      format: 'json' as const,
      selection: { sets: ['accounts'], zone: 'UTC' },
    };
    await useCase.execute(command);
    await expect(
      useCase.execute({ ...command, format: 'csv' }),
    ).rejects.toBeInstanceOf(ExportJobValidationError);
    allowed = false;
    await expect(useCase.execute(command)).rejects.toThrow('revoked');
    expect(repo.jobs).toHaveProperty('size', 1);
  });
  it('revalidates authorization before returning a signed private URL', async () => {
    const repo = new Repo();
    const store = new Store();
    let allowed = true;
    const auth = {
      assertCanExport: async () => {
        if (!allowed) throw new Error('revoked');
      },
    };
    const job: ExportJob = {
      id: ids.generate(),
      actorId: actor,
      idempotencyKey: 'k',
      format: 'csv',
      selection: { sets: ['accounts'], zone: 'UTC' },
      filters: parseExportSelection({ sets: ['accounts'], zone: 'UTC' })
        .filters,
      status: 'completed',
      progress: 100,
      storageKey: 'private/key',
      errorCode: null,
      createdAt: at,
      expiresAt: new Date(at.getTime() + 86400000),
      updatedAt: at,
    };
    await repo.create(job);
    const useCase = new GetExportDownloadUseCase(repo, auth, store, clock);
    expect(await useCase.execute(actor, job.id)).toBe(
      'https://private.test/private/key',
    );
    allowed = false;
    await expect(useCase.execute(actor, job.id)).rejects.toThrow('revoked');
  });
  it('deletes expired private material and marks the job expired', async () => {
    const repo = new Repo();
    const store = new Store();
    const job: ExportJob = {
      id: ids.generate(),
      actorId: actor,
      idempotencyKey: 'k',
      format: 'xlsx',
      selection: { sets: ['accounts'], zone: 'UTC' },
      filters: parseExportSelection({ sets: ['accounts'], zone: 'UTC' })
        .filters,
      status: 'completed',
      progress: 100,
      storageKey: 'private/key',
      errorCode: null,
      createdAt: at,
      expiresAt: new Date(at.getTime() - 1),
      updatedAt: at,
    };
    await repo.create(job);
    const useCase = new GetExportDownloadUseCase(
      repo,
      { assertCanExport: async () => undefined },
      store,
      clock,
    );
    await expect(useCase.execute(actor, job.id)).rejects.toBeInstanceOf(
      ExportJobExpiredError,
    );
    expect(store.deleted).toEqual(['private/key']);
    expect((await repo.getOwned(actor, job.id))?.status).toBe('expired');
  });
});
