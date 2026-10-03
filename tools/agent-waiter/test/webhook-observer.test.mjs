import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';

test('records a signed GitHub completion before acknowledging it', async () => {
  process.env.GITHUB_WEBHOOK_SECRET = 'github-test-secret';
  process.env.KV_REST_API_URL = 'https://redis.example.test';
  process.env.KV_REST_API_TOKEN = 'synthetic-test-token';
  const commands = [];
  const priorFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    commands.push(JSON.parse(options.body));
    return Response.json({ result: 1 });
  };
  const { default: github } = await import('../dist/api/github.js');
  const body = JSON.stringify({
    action: 'completed',
    workflow_run: {
      id: 42,
      head_sha: 'abc123',
      name: 'CI',
      conclusion: 'success',
    },
  });
  const response = await github.fetch(
    new Request('https://example.test/api/github', {
      method: 'POST',
      headers: {
        'X-GitHub-Event': 'workflow_run',
        'X-Hub-Signature-256': signature(
          body,
          process.env.GITHUB_WEBHOOK_SECRET,
        ),
      },
      body,
    }),
  );
  globalThis.fetch = priorFetch;
  assert.equal(response.status, 202);
  assert.deepEqual(await response.json(), { status: 'recorded' });
  assert.equal(commands.length, 4);
  assert.equal(commands[0][0], 'RPUSH');
  assert.equal(commands[1][0], 'EXPIRE');
  assert.equal(commands[2][0], 'RPUSH');
  assert.equal(commands[3][0], 'EXPIRE');
  assert.equal(JSON.parse(commands[0][2]).outcome, 'success');
});

test('records a signed Jira issue status without its financial payload', async () => {
  process.env.JIRA_WEBHOOK_SECRET = 'jira-test-secret';
  process.env.KV_REST_API_URL = 'https://redis.example.test';
  process.env.KV_REST_API_TOKEN = 'synthetic-test-token';
  const commands = [];
  const priorFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    commands.push(JSON.parse(options.body));
    return Response.json({ result: 1 });
  };
  const { default: jira } = await import('../dist/api/jira.js');
  const body = JSON.stringify({
    issue: {
      id: '10001',
      fields: { status: { id: '3' }, description: 'private financial text' },
    },
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
  globalThis.fetch = priorFetch;
  assert.equal(response.status, 202);
  assert.deepEqual(await response.json(), { status: 'recorded' });
  assert.equal(commands.length, 2);
  assert.equal(commands[0][0], 'RPUSH');
  assert.equal(JSON.parse(commands[0][2]).statusId, '3');
  assert.equal(commands[0][2].includes('private financial text'), false);
});

test('asks the provider to retry when the event store is unavailable', async () => {
  process.env.GITHUB_WEBHOOK_SECRET = 'github-test-secret';
  process.env.KV_REST_API_URL = 'https://redis.example.test';
  process.env.KV_REST_API_TOKEN = 'synthetic-test-token';
  const priorFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error('store unavailable');
  };
  const { default: github } = await import('../dist/api/github.js');
  const body = JSON.stringify({
    action: 'completed',
    workflow_run: { id: 42, conclusion: 'failure' },
  });
  const response = await github.fetch(
    new Request('https://example.test/api/github', {
      method: 'POST',
      headers: {
        'X-GitHub-Event': 'workflow_run',
        'X-Hub-Signature-256': signature(
          body,
          process.env.GITHUB_WEBHOOK_SECRET,
        ),
      },
      body,
    }),
  );
  globalThis.fetch = priorFetch;
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: 'event_store_unavailable' });
});

function signature(body, secret) {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
}
