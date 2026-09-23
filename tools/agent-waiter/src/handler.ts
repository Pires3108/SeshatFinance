import type { Completion, PendingTask } from './core.js';
import { taskKey } from './core.js';
import { resumeTask, type RedisTaskStore } from './infrastructure.js';

export async function completeAndResume(
  store: RedisTaskStore,
  lookup: Pick<PendingTask, 'provider' | 'resourceId' | 'githubEvent'>,
  completion: Completion,
  callbackSecret: string,
): Promise<'ignored' | 'resumed' | 'retry'> {
  const key = taskKey(lookup);
  const task = await store.get(key);
  if (task === null) return 'ignored';
  if (!(await store.acquire(task))) return 'ignored';

  try {
    const resumed = await resumeTask(task, completion, callbackSecret);
    if (!resumed) return 'retry';
    await store.remove(task);
    return 'resumed';
  } finally {
    await store.release(task);
  }
}

export function json(status: number, body: Record<string, unknown>): Response {
  return Response.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}

export async function readJson(request: Request): Promise<unknown> {
  const body = await request.text();
  if (body.length > 64_000) throw new Error('Request body is too large.');
  return JSON.parse(body) as unknown;
}
