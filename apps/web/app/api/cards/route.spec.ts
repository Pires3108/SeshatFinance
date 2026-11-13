import { afterEach, describe, expect, it, vi } from 'vitest';

import { PATCH } from './[cardId]/route';
import { GET as getCycle } from './[cardId]/cycle/route';
import { POST as postPurchase } from './[cardId]/purchases/route';
import { GET, POST } from './route';

const session = `__Host-seshat_session=${'a'.repeat(43)}`;
const cardId = 'c722103a-e28a-482c-b6e9-e3320d8a44e3';

function browserRequest(url: string, init: RequestInit = {}): Request {
  return new Request(`http://localhost:3000${url}`, {
    ...init,
    headers: { cookie: `theme=dark; ${session}` },
  });
}

afterEach(() => vi.unstubAllGlobals());

describe('credit card browser proxy', () => {
  it('forwards only the session cookie and returns the API body', async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json([{ id: cardId }]));
    vi.stubGlobal('fetch', fetch);

    const response = await GET(browserRequest('/api/cards'));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual([{ id: cardId }]);
    const [url, init] = fetch.mock.calls[0] as [URL, RequestInit];
    expect(url.pathname).toBe('/api/v1/credit-cards');
    expect(init.headers).toEqual({ Cookie: session });
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('rejects requests without a session before calling the API', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);

    const response = await GET(new Request('http://localhost:3000/api/cards'));

    expect(response.status).toBe(401);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON bodies', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);

    const response = await POST(
      browserRequest('/api/cards', { body: '{', method: 'POST' }),
    );

    expect(response.status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('maps upstream conflicts without echoing the upstream body', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          Response.json({ error: { internal: 'detail' } }, { status: 409 }),
        ),
    );

    const response = await PATCH(
      browserRequest(`/api/cards/${cardId}`, {
        body: JSON.stringify({ expectedVersion: 1 }),
        method: 'PATCH',
      }),
      { params: Promise.resolve({ cardId }) },
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: 'conflict' });
  });

  it('rejects a non-uuid card id and forwards a valid cycle instant', async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ cardId }));
    vi.stubGlobal('fetch', fetch);

    const invalid = await getCycle(browserRequest('/api/cards/x/cycle'), {
      params: Promise.resolve({ cardId: '../accounts' }),
    });
    expect(invalid.status).toBe(404);

    const response = await getCycle(
      browserRequest(`/api/cards/${cardId}/cycle?at=2026-10-27T12:00:00.000Z`),
      { params: Promise.resolve({ cardId }) },
    );
    expect(response.status).toBe(200);
    const [url] = fetch.mock.calls[0] as [URL];
    expect(url.pathname).toBe(`/api/v1/credit-cards/${cardId}/cycle`);
    expect(url.searchParams.get('at')).toBe('2026-10-27T12:00:00.000Z');
  });
});

describe('card purchase browser proxy', () => {
  it('forwards a UUID v4 idempotency key and rejects a missing one', async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ id: cardId }));
    vi.stubGlobal('fetch', fetch);
    const key = '6f1c2f5e-8a4b-4c1d-9e2f-3a4b5c6d7e8f';
    const context = { params: Promise.resolve({ cardId }) };

    const missing = await postPurchase(
      browserRequest(`/api/cards/${cardId}/purchases`, {
        body: '{}',
        method: 'POST',
      }),
      context,
    );
    expect(missing.status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();

    const request = new Request(
      `http://localhost:3000/api/cards/${cardId}/purchases`,
      {
        body: '{}',
        headers: { cookie: session, 'idempotency-key': key },
        method: 'POST',
      },
    );
    const response = await postPurchase(request, context);
    expect(response.status).toBe(200);
    const [, init] = fetch.mock.calls[0] as [URL, RequestInit];
    expect(init.headers).toMatchObject({
      Cookie: session,
      'Idempotency-Key': key,
    });
  });
});

describe('proxy error mapping', () => {
  it('keeps a 422 from the API distinct from invalid input', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(Response.json({}, { status: 422 })),
    );

    const response = await POST(
      browserRequest('/api/cards', { body: '{}', method: 'POST' }),
    );

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({ error: 'unprocessable' });
  });
});
