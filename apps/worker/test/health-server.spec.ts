import type { AddressInfo } from 'node:net';

import { afterEach, describe, expect, it } from 'vitest';

import { createHealthServer } from '../src/health-server.js';

describe('worker health', () => {
  const server = createHealthServer();

  afterEach(async (): Promise<void> => {
    if (server.listening) {
      await new Promise<void>((resolve, reject): void => {
        server.close((error): void => {
          if (error !== undefined) reject(error);
          else resolve();
        });
      });
    }
  });

  it('reports the service as healthy', async (): Promise<void> => {
    await new Promise<void>((resolve): void => {
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address() as AddressInfo;

    const response = await fetch(
      `http://127.0.0.1:${String(address.port)}/health`,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      service: 'worker',
      status: 'ok',
    });
  });
});
