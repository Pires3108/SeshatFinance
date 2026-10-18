import { afterEach, describe, expect, it, vi } from 'vitest';

import { DELETE } from './route.js';

const cookie = `__Host-seshat_session=${'a'.repeat(43)}`;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('remote browser session closure proxy', () => {
  it('requires a valid host-only session cookie', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const response = await DELETE(
      new Request('http://localhost/api/auth/sessions/others'),
    );
    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('forwards only the session cookie and no provider credentials', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 204,
        headers: { 'Set-Cookie': 'provider_token=secret' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const response = await DELETE(
      new Request('http://localhost/api/auth/sessions/others', {
        method: 'DELETE',
        headers: { Cookie: `${cookie}; unrelated=secret` },
      }),
    );
    expect(response.status).toBe(204);
    expect(response.headers.has('set-cookie')).toBe(false);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.objectContaining({ pathname: '/api/v1/auth/sessions/others' }),
      expect.objectContaining({
        headers: { Cookie: cookie },
        method: 'DELETE',
      }),
    );
  });
});
