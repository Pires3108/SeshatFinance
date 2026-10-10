import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { test } from 'node:test';

test(
  'bootstrap handles an occupied default port and preserves its synthetic seed after restart',
  { timeout: 300_000 },
  async () => {
    const occupied = createServer();
    await new Promise((resolve, reject) => {
      occupied.once('error', (error) => {
        if ('code' in error && error.code === 'EADDRINUSE') resolve(undefined);
        else reject(error);
      });
      occupied.listen(5432, '0.0.0.0', () => resolve(undefined));
    });
    const available = createServer();
    await new Promise((resolve) =>
      available.listen(0, '127.0.0.1', () => resolve(undefined)),
    );
    const address = available.address();
    assert.ok(address && typeof address !== 'string');
    const port = String(address.port);
    await new Promise((resolve, reject) =>
      available.close((error) => (error ? reject(error) : resolve(undefined))),
    );
    const environment = {
      ...process.env,
      POSTGRES_PORT: port,
      DATABASE_URL: `postgresql://seshat:seshat@localhost:${port}/seshat?schema=public`,
      COMPOSE_PROJECT_NAME: `seshat-bootstrap-test-${process.pid}`,
    };
    /** @param {string} command @param {string[]} args @returns {string} */
    function run(command, args) {
      const result = spawnSync(command, args, {
        env: environment,
        encoding: 'utf8',
        timeout: 180_000,
      });
      assert.equal(
        result.status,
        0,
        `Bootstrap verification command failed: ${result.error?.message ?? result.stderr}`,
      );
      return result.stdout.trim();
    }
    function seedCount() {
      return run('docker', [
        'compose',
        'exec',
        '-T',
        'postgres',
        'psql',
        '-U',
        'seshat',
        '-d',
        'seshat',
        '-At',
        '-c',
        "SELECT count(*) FROM user_profiles WHERE id = '00000000-0000-4000-8000-000000000001'",
      ]);
    }
    try {
      run(process.execPath, ['tools/bootstrap-local-database.mjs']);
      assert.equal(seedCount(), '1');
      const config = JSON.parse(
        run('docker', ['compose', 'config', '--format', 'json']),
      );
      assert.equal(config.services.postgres.ports[0].target, 5432);
      assert.equal(String(config.services.postgres.ports[0].published), port);
      run('docker', ['compose', 'down']);
      run(process.execPath, ['tools/bootstrap-local-database.mjs']);
      assert.equal(seedCount(), '1');
    } finally {
      run('docker', ['compose', 'down', '--volumes']);
      if (occupied.listening)
        await new Promise((resolve) =>
          occupied.close(() => resolve(undefined)),
        );
    }
  },
);
