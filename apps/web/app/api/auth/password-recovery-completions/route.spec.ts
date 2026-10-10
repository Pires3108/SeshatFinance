import { afterEach, describe, expect, it, vi } from 'vitest';

import { POST } from './route';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  delete process.env.SESHAT_API_URL;
});

function request(body: unknown): Request {
  return new Request(
    'http://localhost:3000/api/auth/password-recovery-completions',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
}

describe('web password recovery completion proxy', () => {
  it('rejects malformed input without contacting the API', async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock;
    const response = await POST(
      request({ tokenHash: 'bad token', password: 'new-password-long' }),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'invalid_input' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects passwords shorter than 12 characters before contacting the API', async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock;
    const response = await POST(
      request({ tokenHash: 'synthetic-token', password: 'short' }),
    );
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: 'password_invalid' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('forwards valid input without caching and returns success without provider data', async () => {
    process.env.SESHAT_API_URL = 'http://api.internal:3001';
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 204 }));
    const response = await POST(
      request({ tokenHash: 'synthetic-token', password: 'new-password-long' }),
    );
    expect(response.status).toBe(204);
    expect(await response.text()).toBe('');
    const [url, options] = vi.mocked(globalThis.fetch).mock.calls[0] ?? [];
    expect(url).toBeInstanceOf(URL);
    expect((url as URL).href).toBe(
      'http://api.internal:3001/api/v1/auth/password-recovery-completions',
    );
    expect(options?.cache).toBe('no-store');
    expect(typeof options?.body).toBe('string');
    expect(JSON.parse(options?.body as string)).toEqual({
      tokenHash: 'synthetic-token',
      password: 'new-password-long',
    });
  });

  it('maps invalid or replayed tokens to a generic error', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(
        Response.json({ error: 'provider-specific-detail' }, { status: 400 }),
      );
    const response = await POST(
      request({ tokenHash: 'synthetic-token', password: 'new-password-long' }),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'invalid_token' });
  });

  it('maps a rejected password without leaking provider details', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(
        Response.json({ error: 'provider-specific-detail' }, { status: 422 }),
      );
    const response = await POST(
      request({ tokenHash: 'synthetic-token', password: 'new-password-long' }),
    );
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: 'password_rejected' });
  });

  it('does not expose upstream outage details', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(
        Response.json({ error: 'provider-specific-detail' }, { status: 503 }),
      );
    const response = await POST(
      request({ tokenHash: 'synthetic-token', password: 'new-password-long' }),
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'recovery_unavailable' });
  });
});
