import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const marker = 'health-smoke-private-sentinel';

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

/** @type {NodeJS.Signals[]} */
const terminationSignals = ['SIGTERM', 'SIGKILL'];

for (const service of ['api', 'worker']) {
  for (const signal of terminationSignals) {
    test(
      `${service} liveness ends after ${signal}`,
      { timeout: 90_000 },
      async (t) => {
        const port = await availablePort();
        const url = `http://127.0.0.1:${port}${service === 'api' ? '/api/v1' : ''}/health`;
        const child = spawn(
          process.execPath,
          [`apps/${service}/dist/main.js`],
          {
            cwd: root,
            env: {
              ...process.env,
              NODE_ENV: 'production',
              API_PORT: String(port),
              WORKER_PORT: String(port),
              DATABASE_URL: `postgresql://unused:${marker}@127.0.0.1:1/unused`,
              SUPABASE_URL: 'http://127.0.0.1:1',
              SUPABASE_PUBLISHABLE_KEY: marker,
              AUTH_CONFIRMATION_REDIRECT_URL: 'http://127.0.0.1:1/confirmacao',
            },
            stdio: ['ignore', 'pipe', 'pipe'],
          },
        );
        const exited = once(child, 'close');
        let output = '';
        assert.ok(child.stdout && child.stderr);
        child.stdout.on('data', (/** @type {Buffer} */ chunk) => {
          output += chunk.toString();
        });
        child.stderr.on('data', (/** @type {Buffer} */ chunk) => {
          output += chunk.toString();
        });
        t.after(async () => {
          if (child.exitCode === null && child.signalCode === null)
            child.kill('SIGKILL');
          await exited;
        });

        let response;
        const deadline = Date.now() + 60_000;
        while (Date.now() < deadline) {
          assert.equal(
            child.exitCode,
            null,
            `${service} exited before liveness was available`,
          );
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
        assert.ok(response, `${service} did not start within 60 seconds`);
        assert.equal(response.status, 200);
        assert.match(
          response.headers.get('content-type') ?? '',
          /application\/json/u,
        );
        assert.deepEqual(await response.json(), { service, status: 'ok' });
        if (service === 'api') {
          const readiness = await globalThis.fetch(`${url}/ready`, {
            signal: globalThis.AbortSignal.timeout(5_000),
          });
          assert.equal(readiness.status, 503);
          assert.equal((await readiness.text()).includes(marker), false);
          const liveness = await globalThis.fetch(url, {
            signal: globalThis.AbortSignal.timeout(1_000),
          });
          assert.equal(liveness.status, 200);
          assert.deepEqual(await liveness.json(), { service, status: 'ok' });
        }
        // Liveness works even while the database and identity provider are unavailable.
        assert.equal(
          output.includes(marker),
          false,
          'startup logs exposed a secret',
        );

        assert.ok(child.kill(signal), `${service} could not be terminated`);
        await exited;
        await assert.rejects(
          globalThis.fetch(url, {
            signal: globalThis.AbortSignal.timeout(1_000),
          }),
        );
        assert.equal(
          output.includes(marker),
          false,
          'shutdown logs exposed a secret',
        );
      },
    );
  }
}
