import { afterEach, describe, expect, it, vi } from 'vitest';

import { DELETE, GET, POST } from './route';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  delete process.env.SESHAT_API_URL;
});

const cookie = `__Host-seshat_session=${'a'.repeat(43)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=43200`;
const expiredCookie =
  '__Host-seshat_session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0';
const credentials = {
  email: 'synthetic@example.test',
  password: 'synthetic-password',
};

function request(
  method: string,
  body?: unknown,
  cookieHeader?: string,
): Request {
  return new Request('http://localhost:3000/api/auth/sessions', {
    method,
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(cookieHeader === undefined ? {} : { Cookie: cookieHeader }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

describe('web session proxy', () => {
  it('rejects malformed credentials locally', async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock;
    expect(
      (await POST(request('POST', { email: 'invalid', password: '' }))).status,
    ).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('forwards only the secure cookie on login', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 204,
        headers: { 'Set-Cookie': cookie },
      }),
    );
    const response = await POST(
      request('POST', {
        email: 'synthetic@example.test',
        password: 'synthetic-password',
      }),
    );
    expect(response.status).toBe(204);
    expect(response.headers.get('set-cookie')).toBe(cookie);
    expect(await response.text()).toBe('');
  });

  it.each([
    ['missing', null],
    ['missing HttpOnly', cookie.replace('HttpOnly; ', '')],
    ['missing Secure', cookie.replace('Secure; ', '')],
    ['unsafe SameSite', cookie.replace('SameSite=Lax', 'SameSite=None')],
    ['unsafe path', cookie.replace('Path=/', 'Path=/auth')],
    ['domain attribute', `${cookie}; Domain=example.test`],
    ['extra cookie', `${cookie}, provider_token=secret`],
    ['wrong name', cookie.replace('__Host-seshat_session', 'session')],
    ['invalid token', cookie.replace('a'.repeat(43), 'provider-secret')],
  ])('rejects %s upstream login cookie', async (_label, setCookie) => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 204,
        ...(setCookie === null ? {} : { headers: { 'Set-Cookie': setCookie } }),
      }),
    );
    const response = await POST(request('POST', credentials));
    expect(response.status).toBe(502);
    expect(response.headers.has('set-cookie')).toBe(false);
    expect(await response.json()).toEqual({ error: 'login_unavailable' });
  });

  it('rejects an unsafe logout cookie', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 204,
        headers: { 'Set-Cookie': cookie },
      }),
    );
    const response = await DELETE(request('DELETE', undefined, cookie));
    expect(response.status).toBe(502);
    expect(response.headers.has('set-cookie')).toBe(false);
  });

  it('forwards only a safe expiration cookie on logout', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 204,
        headers: { 'Set-Cookie': expiredCookie },
      }),
    );
    const response = await DELETE(request('DELETE', undefined, cookie));
    expect(response.status).toBe(204);
    expect(response.headers.get('set-cookie')).toBe(expiredCookie);
    expect(await response.text()).toBe('');
  });

  it('forwards the browser cookie for status and revocation', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 204,
        headers: { 'Set-Cookie': expiredCookie },
      }),
    );
    globalThis.fetch = fetchMock;
    expect((await GET(request('GET', undefined, cookie))).status).toBe(204);
    expect((await DELETE(request('DELETE', undefined, cookie))).status).toBe(
      204,
    );
    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(URL),
      expect.objectContaining({ headers: { Cookie: cookie } }),
    );
  });
});
