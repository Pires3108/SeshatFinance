import { describe, expect, it } from 'vitest';

import { WorkerJobRunner } from './job-runner.js';

const correlationId = 'a36bf45e-2b6d-48e5-82d6-d4607bf2b4b9';

describe('WorkerJobRunner', () => {
  it('correlates an asynchronous failure and emits only safe metadata', async () => {
    const entries: unknown[] = [];
    const runner = new WorkerJobRunner((entry): void => {
      entries.push(entry);
    });
    const secret =
      'SQL password=secret-marker token=token-marker amount=987654.32';

    await expect(
      runner.run({ correlationId }, async (): Promise<never> => {
        await Promise.resolve();
        expect(runner.context.getCorrelationId()).toBe(correlationId);
        throw new Error(secret);
      }),
    ).rejects.toThrow(secret);

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      action: 'job_failed',
      correlationId,
      resourceType: 'job',
      outcome: 'failure',
    });
    expect(JSON.stringify(entries)).not.toMatch(
      /SQL|secret-marker|token-marker|987654/u,
    );
  });
});
