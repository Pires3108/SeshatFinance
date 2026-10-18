import { describe, expect, it } from 'vitest';
import { ObservedJobRunner } from './observed-job-runner.js';
import { OperationCorrelationContext } from './correlation-context.js';
import { safeLogMetadata, type SafeLogEntry } from './safe-log-metadata.js';

const firstId = 'a36bf45e-2b6d-48e5-82d6-d4607bf2b4b9';
const secondId = '8c912211-486b-4e36-a349-f7051c9eb8d2';

describe('privacy-safe operation observation', () => {
  it('strips prohibited fields and replaces arbitrary identifiers', () => {
    const entry = safeLogMetadata({
      action: 'job_failed',
      resourceType: 'job',
      outcome: 'failure',
      durationMs: 2.5,
      correlationId: 'secret-token',
      email: 'secret@example.test',
      amount: '987654.32',
      attachment: 'private.pdf',
    } as SafeLogEntry);
    expect(entry).toEqual({
      action: 'job_failed',
      resourceType: 'job',
      outcome: 'failure',
      durationMs: 3,
      correlationId: 'unavailable',
    });
    expect(JSON.stringify(entry)).not.toMatch(/secret|987654|private/u);
  });
  it('propagates the opaque identifier in serializable job metadata across an async failure', async () => {
    const api = new OperationCorrelationContext();
    const worker = new OperationCorrelationContext();
    const entries: SafeLogEntry[] = [];
    const runner = new ObservedJobRunner(worker, (entry): void => {
      entries.push(entry);
    });
    await api.run(firstId, async (): Promise<void> => {
      await Promise.resolve();
      const metadata = JSON.parse(JSON.stringify(api.createJobMetadata())) as {
        correlationId: string;
      };
      await expect(
        runner.run(metadata, async (): Promise<never> => {
          await Promise.resolve();
          expect(worker.getCorrelationId()).toBe(firstId);
          throw new Error('SQL secret-token 987654.32 private.pdf');
        }),
      ).rejects.toThrow('SQL');
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      action: 'job_failed',
      outcome: 'failure',
      correlationId: firstId,
    });
    expect(JSON.stringify(entries)).not.toMatch(
      /SQL|secret-token|987654|private/u,
    );
    expect(worker.getCorrelationId()).toBeUndefined();
  });
  it('keeps parallel asynchronous job identifiers isolated', async () => {
    const context = new OperationCorrelationContext();
    const entries: SafeLogEntry[] = [];
    const runner = new ObservedJobRunner(context, (entry): void => {
      entries.push(entry);
    });
    await Promise.all(
      [firstId, secondId].map(async (correlationId): Promise<void> => {
        await runner.run({ correlationId }, async (): Promise<void> => {
          await new Promise<void>((resolve): void => {
            setTimeout(resolve, 5);
          });
          expect(context.getCorrelationId()).toBe(correlationId);
        });
      }),
    );
    expect(entries.map((entry) => entry.correlationId).sort()).toEqual(
      [firstId, secondId].sort(),
    );
  });
});
