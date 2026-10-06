import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const marker = 'health-smoke-private-sentinel';

async function availablePort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  return port;
}

for (const service of ['api', 'worker']) {
  for (const signal of ['SIGTERM', 'SIGKILL']) {
    test(
      `${service} liveness ends after ${signal}`,
      { timeout: 30_000 },
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
        const exited = once(child, 'exit');
        let output = '';
        child.stdout.on('data', (chunk) => {
          output += chunk.toString();
        });
        child.stderr.on('data', (chunk) => {
          output += chunk.toString();
        });
        t.after(async () => {
          if (child.exitCode === null && child.signalCode === null)
            child.kill('SIGKILL');
          await exited;
        });

        let response;
        const deadline = Date.now() + 20_000;
        while (Date.now() < deadline) {
          assert.equal(
            child.exitCode,
            null,
            `${service} exited before liveness was available`,
          );
          try {
            response = await fetch(url, { signal: AbortSignal.timeout(500) });
            break;
          } catch {
            await delay(100);
          }
        }
        assert.ok(response, `${service} did not start within 20 seconds`);
        assert.equal(response.status, 200);
        assert.match(
          response.headers.get('content-type'),
          /application\/json/u,
        );
        assert.deepEqual(await response.json(), { service, status: 'ok' });
        if (service === 'api') {
          const readiness = await fetch(`${url}/ready`, {
            signal: AbortSignal.timeout(5_000),
          });
          assert.equal(readiness.status, 503);
          assert.equal((await readiness.text()).includes(marker), false);
          const liveness = await fetch(url, {
            signal: AbortSignal.timeout(1_000),
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

        child.kill(signal);
        await exited;
        await assert.rejects(
          fetch(url, { signal: AbortSignal.timeout(1_000) }),
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
