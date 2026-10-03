import type { Completion, PendingTask } from './core.js';
import { eventKey, lockKey, signCallback, taskKey } from './core.js';

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

  public async publishCompletion(completion: Completion): Promise<void> {
    const keys = [eventKey(completion)];
    if (completion.headSha !== undefined) {
      keys.push(eventKey({ ...completion, resourceId: completion.headSha }));
    }
    for (const key of keys) {
      await this.command<number>(['RPUSH', key, JSON.stringify(completion)]);
      await this.command<number>(['EXPIRE', key, '86400']);
    }
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
  const connection = resolveRedisConnection(process.env);
  if (connection === null) throw new Error('Task storage is not configured.');
  return new RedisTaskStore(connection.endpoint, connection.token);
}

export function resolveRedisConnection(
  environment: NodeJS.ProcessEnv,
): { readonly endpoint: string; readonly token: string } | null {
  const endpoint =
    environment.UPSTASH_REDIS_REST_URL ?? environment.KV_REST_API_URL;
  const token =
    environment.UPSTASH_REDIS_REST_TOKEN ?? environment.KV_REST_API_TOKEN;
  if (endpoint === undefined || token === undefined) return null;
  return { endpoint, token };
}
