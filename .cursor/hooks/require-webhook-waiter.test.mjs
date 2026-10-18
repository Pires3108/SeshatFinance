import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const hookPath = fileURLToPath(
  new URL('./require-webhook-waiter.mjs', import.meta.url),
);

test('allows a one-off GitHub status lookup', () => {
  const result = runHook({
    command: 'gh run view 123 --json status,conclusion',
  });

  assert.equal(result.permission, 'allow');
});

test('blocks GitHub watch mode', () => {
  const result = runHook({ command: 'gh run watch 123 --exit-status' });

  assert.equal(result.permission, 'deny');
  assert.match(result.agent_message, /progress signal/u);
});

test('blocks sleep loops that poll Jira', () => {
  const result = runHook({
    command:
      'while ($true) { Invoke-RestMethod https://example.atlassian.net/rest/api/3/issue/SESHAT-1; Start-Sleep -Seconds 30 }',
  });

  assert.equal(result.permission, 'deny');
});

function runHook(input) {
  const result = spawnSync(process.execPath, [hookPath], {
    encoding: 'utf8',
    input: JSON.stringify(input),
  });

  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}
