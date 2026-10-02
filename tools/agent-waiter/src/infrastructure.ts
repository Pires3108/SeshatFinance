import type { Completion, PendingTask } from './core.js';
import { lockKey, signCallback, taskKey } from './core.js';

interface RedisResponse<T> {
  readonly result?: T;
  readonly error?: string;
}

export class RedisTaskStore {
  public constructor(
    private readonly endpoint: string,
    private readonly token: string,
  ) {}

  public async create(task: PendingTask): Promise<boolean> {
    const response = await this.command<string | null>([
      'SET',
      taskKey(task),
      JSON.stringify(task),
      'EX',
      String(task.expiresInSeconds),
      'NX',
    ]);
    return response === 'OK';
  }

  public async get(key: string): Promise<PendingTask | null> {
    const value = await this.command<string | null>(['GET', key]);
    if (value === null) return null;
    try {
      return JSON.parse(value) as PendingTask;
    } catch {
      throw new Error('Stored pending task is invalid.');
    }
  }

  public async acquire(task: PendingTask): Promise<boolean> {
    const response = await this.command<string | null>([
      'SET',
      lockKey(task),
      '1',
      'EX',
      '30',
      'NX',
    ]);
    return response === 'OK';
  }

  public async remove(task: PendingTask): Promise<void> {
    await this.command<number>(['DEL', taskKey(task), lockKey(task)]);
  }

  public async release(task: PendingTask): Promise<void> {
    await this.command<number>(['DEL', lockKey(task)]);
  }

  private async command<T>(command: readonly string[]): Promise<T> {
    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(command),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error('Task store is unavailable.');
    const payload = (await response.json()) as RedisResponse<T>;
    if (payload.error !== undefined)
      throw new Error('Task store rejected the request.');
    return payload.result as T;
  }
}

export async function resumeTask(
  task: PendingTask,
  completion: Completion,
  callbackSecret: string,
): Promise<boolean> {
  const payload = JSON.stringify({
    taskHandle: task.taskHandle,
    callId: task.callId,
    output: completion,
  });
  const response = await fetch(task.resumeUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Agent-Waiter-Signature': signCallback(payload, callbackSecret),
    },
    body: payload,
    signal: AbortSignal.timeout(10_000),
  });
  return response.ok;
}

export function createStoreFromEnvironment(): RedisTaskStore {
  const endpoint = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (endpoint === undefined || token === undefined)
    throw new Error('Task storage is not configured.');
  return new RedisTaskStore(endpoint, token);
}
