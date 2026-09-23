import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(
  new URL('./guard-git-commit.mjs', import.meta.url),
);
const fixtureRoot = mkdtempSync(path.join(os.tmpdir(), 'seshat-commit-guard-'));
const main = path.join(fixtureRoot, 'main');
const feature = path.join(fixtureRoot, 'feature');
const detached = path.join(fixtureRoot, 'detached');
const punctuation = path.join(fixtureRoot, 'semi;colon');

try {
  initialize(main, 'main');
  initialize(feature, 'feat/example');
  initialize(detached, 'feat/temporary');
  initialize(punctuation, 'main');
  git(detached, ['checkout', '--detach']);

  test('blocks commits on main and detached HEAD', () => {
    assert.equal(run('git commit -m test', main).permission, 'deny');
    assert.equal(run('git commit -m test', detached).permission, 'deny');
  });

  test('allows a descriptive branch and non-commit commands', () => {
    assert.equal(run('git commit -m test', feature, main).permission, 'allow');
    assert.equal(run('git status', main).permission, 'allow');
  });

  test('checks the target repository for git -C and git.exe variants', () => {
    assert.equal(
      run(`git -C "${main}" commit -m test`, feature).permission,
      'deny',
    );
    assert.equal(
      run(`git.exe -C "${feature}" commit -m test`, main).permission,
      'allow',
    );
  });

  test('checks every commit in a compound shell command', () => {
    assert.equal(
      run(`git status; git -C "${main}" commit -m test`, feature).permission,
      'deny',
    );
  });

  test('does not split a quoted path containing shell punctuation', () => {
    assert.equal(
      run(`git -C "${punctuation}" commit -m test`, feature).permission,
      'deny',
    );
  });
} finally {
  process.on('exit', () => {
    if (
      path.dirname(main) === fixtureRoot &&
      fixtureRoot.startsWith(os.tmpdir())
    ) {
      rmSync(fixtureRoot, { force: true, recursive: true });
    }
  });
}

function initialize(directory, branch) {
  const result = spawnSync('git', ['init', '-b', branch, directory], {
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  git(directory, [
    '-c',
    'user.name=Hook Test',
    '-c',
    'user.email=hook@example.invalid',
    'commit',
    '--allow-empty',
    '-m',
    'fixture',
  ]);
}

function git(directory, args) {
  const result = spawnSync('git', args, { cwd: directory, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
}

function run(command, workdir, cwd = workdir) {
  const result = spawnSync(process.execPath, [script], {
    cwd,
    encoding: 'utf8',
    input: JSON.stringify({ input: { cmd: command, workdir } }),
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}
