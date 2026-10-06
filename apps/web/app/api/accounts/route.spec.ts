import { afterEach, describe, expect, it, vi } from 'vitest';

import { GET } from './route';

const account = {
  archivedAt: null,
  color: null,
  createdAt: '2026-10-01T12:00:00.000Z',
  currencyCode: 'BRL',
  currencyMinorUnitScale: 2,
  description: null,
  icon: null,
  id: 'c15a5404-7f4e-4f4b-a2d8-cb00f406d63a',
  initialBalance: '100.00',
  institution: null,
  lifecycle: 'active',
  name: 'Minha conta',
  trashedAt: null,
  typeKey: 'checking-account',
  updatedAt: '2026-10-01T12:00:00.000Z',
  version: 1,
  fullAccountNumber: 'never-expose-this-field',
};
const balance = {
  amount: '100.00',
  currencyCode: 'BRL',
  currencyMinorUnitScale: 2,
};

afterEach(() => vi.unstubAllGlobals());

describe('account list browser proxy', () => {
  it('returns owned API accounts with their exact API balances and only safe contract fields', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json([account]))
      .mockResolvedValueOnce(Response.json(balance));
    vi.stubGlobal('fetch', fetch);
    const response = await GET(
      new Request('http://localhost:3000/api/accounts?lifecycle=active', {
        headers: {
          Cookie: `analytics=ignore; __Host-seshat_session=${'a'.repeat(43)}`,
        },
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([
      {
        account: {
          id: account.id,
          name: account.name,
          typeKey: account.typeKey,
          lifecycle: account.lifecycle,
          currencyCode: account.currencyCode,
          currencyMinorUnitScale: account.currencyMinorUnitScale,
        },
        balance,
      },
    ]);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[0]?.[0]).toBeInstanceOf(URL);
    const init = fetch.mock.calls[0]?.[1] as RequestInit;
    expect(new Headers(init.headers).get('cookie')).toBe(
      `__Host-seshat_session=${'a'.repeat(43)}`,
    );
  });

  it('hides all account data if the balance request loses authorization', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(Response.json([account]))
        .mockResolvedValueOnce(new Response(null, { status: 401 })),
    );
    const response = await GET(
      new Request('http://localhost:3000/api/accounts'),
    );
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'unauthorized' });
  });

  it('rejects a balance that exceeds the currency scale', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(Response.json([account]))
        .mockResolvedValueOnce(
          Response.json({ ...balance, amount: '100.001' }),
        ),
    );
    const response = await GET(
      new Request('http://localhost:3000/api/accounts'),
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'unavailable' });
  });

  it('rejects an invalid filter before calling the API', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const response = await GET(
      new Request('http://localhost:3000/api/accounts?lifecycle=all'),
    );
    expect(response.status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });
});
