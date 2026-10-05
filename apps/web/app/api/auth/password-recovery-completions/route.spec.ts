import { afterEach, describe, expect, it, vi } from 'vitest';

import { POST } from './route';

describe('web password recovery completion proxy', () => {
  afterEach((): void => {
    vi.unstubAllGlobals();
  });

  it('forwards the token only in the request body and returns no secret', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetch);
    const request = new Request(
      'http://localhost/api/auth/password-recovery-completions',
      {
        method: 'POST',
        body: JSON.stringify({
          tokenHash: 'synthetic-token',
          password: 'synthetic-password',
        }),
      },
    );

    const response = await POST(request);

    expect(response.status).toBe(204);
    expect(await response.text()).toBe('');
    expect(fetch).toHaveBeenCalledWith(
      new URL(
        'http://localhost:3001/api/v1/auth/password-recovery-completions',
      ),
      expect.objectContaining({ method: 'POST', cache: 'no-store' }),
    );
  });

  it('conceals upstream details for an expired link', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response('private provider detail', { status: 400 }),
        ),
    );
    const request = new Request(
      'http://localhost/api/auth/password-recovery-completions',
      {
        method: 'POST',
        body: JSON.stringify({
          tokenHash: 'synthetic-token',
          password: 'synthetic-password',
        }),
      },
    );

    const response = await POST(request);

    expect(response.status).toBe(400);
    const body = await response.text();
    expect(body).not.toContain('private provider detail');
    expect(body).not.toContain('synthetic-token');
  });

  it('keeps a provider outage distinct from an invalid link', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(null, { status: 503 })),
    );
    const response = await POST(
      new Request('http://localhost/api/auth/password-recovery-completions', {
        method: 'POST',
        body: JSON.stringify({
          tokenHash: 'synthetic-token',
          password: 'synthetic-password',
        }),
      }),
    );

    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('synthetic-token');
  });
});
