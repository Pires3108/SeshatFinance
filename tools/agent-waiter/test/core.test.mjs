import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';
import {
  extractGitHubCompletion,
  extractJiraCompletion,
  eventKey,
  parsePendingTask,
  taskKey,
  verifyHmac,
} from '../dist/src/core.js';

test('parses a bounded GitHub task and keeps event type in its key', () => {
  const task = parsePendingTask({
    provider: 'github',
    resourceId: '42',
    taskHandle: 'ci-42',
    callId: 'call-42',
    resumeUrl: 'https://agent.example.test/resume',
    githubEvent: 'workflow_run',
    expiresInSeconds: 120,
  });
  assert.equal(task.githubEvent, 'workflow_run');
  assert.notEqual(
    taskKey(task),
    taskKey({ ...task, githubEvent: 'check_run' }),
  );
});

test('rejects a Jira registration without an explicit terminal status', () => {
  assert.throws(() =>
    parsePendingTask({
      provider: 'jira',
      resourceId: '10001',
      taskHandle: 'jira-1',
      callId: 'call-1',
      resumeUrl: 'https://agent.example.test/resume',
    }),
  );
});

test('verifies raw-body signatures in constant-time comparison', () => {
  const body = '{"ok":true}';
  const secret = 'secret';
  const signature = `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
  assert.equal(verifyHmac(body, signature, secret), true);
  assert.equal(verifyHmac(`${body} `, signature, secret), false);
});

test('only treats completed GitHub runs and matching Jira issue payloads as events', () => {
  assert.deepEqual(
    extractGitHubCompletion('workflow_run', {
      action: 'completed',
      workflow_run: {
        id: 42,
        conclusion: 'success',
        updated_at: '2026-09-23T00:00:00.000Z',
      },
    }),
    {
      provider: 'github',
      resourceId: '42',
      event: 'workflow_run',
      outcome: 'success',
      completedAt: '2026-09-23T00:00:00.000Z',
    },
  );
  assert.equal(
    extractGitHubCompletion('workflow_run', { action: 'requested' }),
    null,
  );
  assert.deepEqual(
    extractJiraCompletion({
      issue: { id: '10001', fields: { status: { id: '3' } } },
    }),
    { resourceId: '10001', statusId: '3' },
  );
});

test('separates webhook event queues by provider, event and resource', () => {
  const github = eventKey({
    provider: 'github',
    event: 'check_run',
    resourceId: 'abc',
  });
  assert.notEqual(
    github,
    eventKey({ provider: 'github', event: 'workflow_run', resourceId: 'abc' }),
  );
  assert.notEqual(
    github,
    eventKey({ provider: 'jira', event: 'issue_updated', resourceId: 'abc' }),
  );
});
