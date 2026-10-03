import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';

test('accepts a signed completed GitHub event without task storage', async () => {
  process.env.GITHUB_WEBHOOK_SECRET = 'github-test-secret';
  const { default: github } = await import('../dist/api/github.js');
  const body = JSON.stringify({
    action: 'completed',
    workflow_run: { id: 42, conclusion: 'success' },
  });

  const response = await github.fetch(
    new Request('https://example.test/api/github', {
      method: 'POST',
      headers: {
        'X-GitHub-Event': 'workflow_run',
        'X-Hub-Signature-256': signature(body, process.env.GITHUB_WEBHOOK_SECRET),
      },
      body,
    }),
  );

  assert.equal(response.status, 202);
  assert.deepEqual(await response.json(), { status: 'received' });
});

test('accepts a signed Jira issue update without task storage', async () => {
  process.env.JIRA_WEBHOOK_SECRET = 'jira-test-secret';
  const { default: jira } = await import('../dist/api/jira.js');
  const body = JSON.stringify({
    issue: { id: '10001', fields: { status: { id: '3' } } },
  });

  const response = await jira.fetch(
    new Request('https://example.test/api/jira', {
      method: 'POST',
      headers: {
        'X-Hub-Signature': signature(body, process.env.JIRA_WEBHOOK_SECRET),
      },
      body,
    }),
  );

  assert.equal(response.status, 202);
  assert.deepEqual(await response.json(), { status: 'received' });
});

function signature(body, secret) {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
}
