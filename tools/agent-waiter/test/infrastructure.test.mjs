import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveRedisConnection } from '../dist/src/infrastructure.js';

test('uses the Vercel KV integration environment variables', () => {
  assert.deepEqual(
    resolveRedisConnection({
      KV_REST_API_URL: 'https://example.upstash.io',
      KV_REST_API_TOKEN: 'token',
    }),
    { endpoint: 'https://example.upstash.io', token: 'token' },
  );
});

test('prefers explicitly configured Upstash variables', () => {
  assert.deepEqual(
    resolveRedisConnection({
      UPSTASH_REDIS_REST_URL: 'https://explicit.upstash.io',
      UPSTASH_REDIS_REST_TOKEN: 'explicit-token',
      KV_REST_API_URL: 'https://integration.upstash.io',
      KV_REST_API_TOKEN: 'integration-token',
    }),
    { endpoint: 'https://explicit.upstash.io', token: 'explicit-token' },
  );
});
