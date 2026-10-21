import { afterEach, describe, expect, it, vi } from 'vitest';

import { POST } from './route';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  delete process.env.SESHAT_API_URL;
});

function request(body: unknown): Request {
  return new Request(
    'http://localhost:3000/api/auth/password-recovery-requests',
    {
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    },
  );
}

describe('web password recovery proxy', () => {
  it('rejects malformed input before calling the API', async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock;
    await expect(POST(request({ email: 'invalid' }))).resolves.toMatchObject({
      status: 400,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('forwards a valid request and keeps the generic accepted response', async () => {
    process.env.SESHAT_API_URL = 'http://api.internal:3001';
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(
        Response.json({ status: 'accepted' }, { status: 202 }),
      );
    const response = await POST(request({ email: 'pessoa@example.com' }));
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ status: 'accepted' });
    const upstreamRequest = vi.mocked(globalThis.fetch).mock.calls[0]?.[0];
    expect(upstreamRequest).toBeInstanceOf(Request);
    const forwardedRequest = upstreamRequest as Request;
    expect(forwardedRequest.url).toBe(
      'http://api.internal:3001/api/v1/auth/password-recovery-requests',
    );
    expect(forwardedRequest.cache).toBe('no-store');
    expect(forwardedRequest.method).toBe('POST');
    expect(await forwardedRequest.json()).toEqual({
      email: 'pessoa@example.com',
    });
  });

  it('rejects an unexpected response body', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(
        Response.json({ status: 'unexpected' }, { status: 202 }),
      );
    const response = await POST(request({ email: 'pessoa@example.com' }));
    expect(response.status).toBe(502);
  });
});
