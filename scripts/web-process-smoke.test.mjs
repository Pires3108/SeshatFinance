import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const webRoot = fileURLToPath(new URL('../apps/web/', import.meta.url));
const nextCli = fileURLToPath(
  new URL('../apps/web/node_modules/next/dist/bin/next', import.meta.url),
);

/** @returns {Promise<number>} */
async function availablePort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const port = address.port;
  const closed = once(server, 'close');
  server.close();
  await closed;
  return port;
}

test(
  'compiled web process serves the public home page and stops after shutdown',
  { timeout: 90_000 },
  async (t) => {
    const port = await availablePort();
    const url = `http://127.0.0.1:${port}/`;
    const child = spawn(
      process.execPath,
      [nextCli, 'start', '-p', String(port), '-H', '127.0.0.1'],
      {
        cwd: webRoot,
        env: {
          ...process.env,
          NODE_ENV: 'production',
          NEXT_TELEMETRY_DISABLED: '1',
        },
        stdio: 'ignore',
      },
    );
    const exited = once(child, 'close');
    t.after(async () => {
      if (child.exitCode === null && child.signalCode === null)
        child.kill('SIGKILL');
      await exited;
    });

    let response;
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      assert.equal(child.exitCode, null, 'web exited before startup');
      assert.equal(child.signalCode, null);
      try {
        response = await globalThis.fetch(url, {
          signal: globalThis.AbortSignal.timeout(500),
        });
        break;
      } catch {
        await delay(100);
      }
    }
    assert.ok(response, 'web did not start within 60 seconds');
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') ?? '', /text\/html/u);
    const html = await response.text();
    assert.match(html, /Seshat Finance/u);
    assert.match(html, /Um lugar para entender seu dinheiro/u);

    assert.ok(child.kill('SIGTERM'), 'web could not be terminated');
    await exited;
    await assert.rejects(
      globalThis.fetch(url, {
        signal: globalThis.AbortSignal.timeout(1_000),
      }),
    );
  },
);
