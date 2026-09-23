import { afterEach, describe, expect, it, vi } from 'vitest';

import { POST } from './route';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  delete process.env.SESHAT_API_URL;
});

function request(body: unknown): Request {
  return new Request('http://localhost:3000/api/auth/registrations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('web registration proxy', () => {
  it('rejects malformed registration before calling the API', async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock;
    const response = await POST(
      request({ displayName: '', email: 'invalid', password: '' }),
    );
    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('forwards valid input without returning the password', async () => {
    process.env.SESHAT_API_URL = 'http://api.internal:3001';
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 202 }));
    globalThis.fetch = fetchMock;
    const response = await POST(
      request({
        displayName: 'Pessoa',
        email: 'pessoa@example.com',
        password: 'secret',
      }),
    );
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ status: 'confirmation_required' });
    expect(fetchMock).toHaveBeenCalledWith(
      new URL('http://api.internal:3001/api/v1/auth/registrations'),
      expect.objectContaining({ method: 'POST', cache: 'no-store' }),
    );
  });

  it('does not expose upstream errors', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(
        new Response('private provider detail', { status: 400 }),
      );
    const response = await POST(
      request({
        displayName: 'Pessoa',
        email: 'pessoa@example.com',
        password: 'secret',
      }),
    );
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain('private provider detail');
  });

  it('does not treat an unexpected upstream response as registration', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 200 }));
    const response = await POST(
      request({
        displayName: 'Pessoa',
        email: 'pessoa@example.com',
        password: 'secret',
      }),
    );
    expect(response.status).toBe(502);
  });
});
