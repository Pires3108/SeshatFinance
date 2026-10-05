import { afterEach, describe, expect, it, vi } from 'vitest';

import { GET } from './route';

afterEach(() => vi.unstubAllGlobals());

describe('account detail browser proxy', () => {
  it('does not expose a foreign account on an upstream 404', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 404 }));
    vi.stubGlobal('fetch', fetch);
    const response = await GET(
      new Request(
        'http://localhost:3000/api/accounts/55d3faba-49cf-4f2e-a921-41a4664c93ae',
      ),
      {
        params: Promise.resolve({
          accountId: '55d3faba-49cf-4f2e-a921-41a4664c93ae',
        }),
      },
    );
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'not-found' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('returns access denied without exposing account data', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(null, { status: 403 })),
    );
    const response = await GET(
      new Request(
        'http://localhost:3000/api/accounts/55d3faba-49cf-4f2e-a921-41a4664c93ae',
      ),
      {
        params: Promise.resolve({
          accountId: '55d3faba-49cf-4f2e-a921-41a4664c93ae',
        }),
      },
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'forbidden' });
  });
});
