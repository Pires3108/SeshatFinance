import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import ts from 'typescript';

test('type checking rejects an incompatible public field', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'seshat-ci-types-'));
  try {
    const file = join(directory, 'contract.ts');
    await writeFile(file, 'export const amount: string = 10;\n');
    const program = ts.createProgram([file], {
      strict: true,
      noEmit: true,
      skipLibCheck: true,
      types: [],
    });
    assert.ok(
      ts.getPreEmitDiagnostics(program).some((error) => error.code === 2322),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('the test command returns failure for a broken assertion', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'seshat-ci-tests-'));
  try {
    const file = join(directory, 'broken.test.mjs');
    await writeFile(
      file,
      "import { test } from 'node:test';\ntest('broken', () => { throw new Error('synthetic failure'); });\n",
    );
    const result = spawnSync(process.execPath, ['--test', file], {
      encoding: 'utf8',
      env: { ...process.env, NODE_TEST_CONTEXT: undefined },
    });
    assert.equal(result.status, 1);
    assert.match(result.stdout, /synthetic failure/u);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('immutable installation rejects manifest drift without rewriting the lock', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'seshat-ci-lock-'));
  try {
    const pnpmPath = process.env.npm_execpath;
    assert.ok(
      pnpmPath,
      'Run through pnpm test:ci so the fixed package manager is available.',
    );
    const manifest = {
      name: 'synthetic-ci-fixture',
      private: true,
      dependencies: { typescript: '5.9.3' },
    };
    await writeFile(join(directory, 'package.json'), JSON.stringify(manifest));
    await writeFile(
      join(directory, 'pnpm-lock.yaml'),
      "lockfileVersion: '9.0'\nsettings:\n  autoInstallPeers: true\n  excludeLinksFromLockfile: false\nimporters:\n  .: {}\n",
    );
    const lockBefore = await readFile(
      join(directory, 'pnpm-lock.yaml'),
      'utf8',
    );
    const result = spawnSync(
      process.execPath,
      [
        pnpmPath,
        'install',
        '--frozen-lockfile',
        '--offline',
        '--ignore-scripts',
      ],
      {
        cwd: directory,
        encoding: 'utf8',
        timeout: 30_000,
      },
    );
    assert.notEqual(result.status, 0);
    assert.match(
      `${result.stdout}${result.stderr}`,
      /OUTDATED_LOCKFILE|frozen.lockfile/iu,
    );
    assert.equal(
      await readFile(join(directory, 'pnpm-lock.yaml'), 'utf8'),
      lockBefore,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
