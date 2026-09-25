import { describe, expect, it, vi } from 'vitest';

import type { LazyPrismaClient } from '../platform/lazy-prisma-client.js';
import { DatabaseReadiness } from './database-readiness.js';

describe('DatabaseReadiness', () => {
  it('reports ready after a constant database query', async () => {
    const query = vi.fn().mockResolvedValue([{ '?column?': 1 }]);
    const prisma = {
      get: () => ({ $queryRaw: query }),
    } as unknown as LazyPrismaClient;

    await expect(new DatabaseReadiness(prisma).isReady()).resolves.toBe(true);
    expect(query).toHaveBeenCalledWith(['SELECT 1']);
  });

  it('reports unavailable without propagating connection errors', async () => {
    const prisma = {
      get: () => ({
        $queryRaw: vi.fn().mockRejectedValue(new Error('secret database URL')),
      }),
    } as unknown as LazyPrismaClient;

    await expect(new DatabaseReadiness(prisma).isReady()).resolves.toBe(false);
  });

  it('stops waiting when the database does not respond', async () => {
    vi.useFakeTimers();
    try {
      const prisma = {
        get: () => ({
          $queryRaw: vi.fn().mockReturnValue(new Promise(() => undefined)),
        }),
      } as unknown as LazyPrismaClient;
      const readiness = new DatabaseReadiness(prisma).isReady();

      await vi.advanceTimersByTimeAsync(2_000);

      await expect(readiness).resolves.toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
