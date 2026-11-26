import type { ChildProcess } from 'node:child_process';
import { mkdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * The web dev server proxies to one API port (3101). Journeys that start
 * their own API there must not overlap across Playwright workers, or one
 * journey reaches another's database and session. An atomic directory acts
 * as a cross-process lock; a lock older than 15 minutes is treated as stale.
 */
const lockPath = join(tmpdir(), 'seshat-web-e2e-api-3101.lock');
const STALE_MS = 15 * 60_000;
const WAIT_MS = 9 * 60_000;

export async function acquireSharedApiPort(): Promise<() => Promise<void>> {
  const deadline = Date.now() + WAIT_MS;
  for (;;) {
    try {
      await mkdir(lockPath);
      return async (): Promise<void> => {
        await rm(lockPath, { force: true, recursive: true });
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
    const age = await stat(lockPath)
      .then((info) => Date.now() - info.mtimeMs)
      .catch(() => 0);
    if (age > STALE_MS) await rm(lockPath, { force: true, recursive: true });
    if (Date.now() > deadline) {
      throw new Error('The shared e2e API port stayed busy.');
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

/** Stops the API and waits for the process to exit, freeing the port. */
export async function stopApi(api: ChildProcess | undefined): Promise<void> {
  if (api?.exitCode !== null || api.signalCode !== null) return;
  await new Promise<void>((resolve) => {
    api.once('exit', () => {
      resolve();
    });
    api.kill();
  });
}
