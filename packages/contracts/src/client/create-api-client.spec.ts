import { afterEach, describe, expect, it, vi } from 'vitest';

import { createApiClient, type ApiClientError } from './create-api-client.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function accepted(): Response {
  return Response.json({ status: 'accepted' }, { status: 202 });
}

describe('typed API client', () => {
  it('keeps anonymous requests free of credentials', async () => {
    const fetchMock = vi.fn().mockResolvedValue(accepted());
    globalThis.fetch = fetchMock;

    await createApiClient({ baseUrl: 'https://api.example.test' }).POST(
      '/api/v1/auth/password-recovery-requests',
      {
        body: { email: 'pessoa@example.com' },
        headers: {
          Authorization: 'Bearer untrusted',
          Cookie: 'session=unsafe',
        },
      },
    );

    const request = fetchMock.mock.calls[0]?.[0] as Request;
    expect(request.url).toBe(
      'https://api.example.test/api/v1/auth/password-recovery-requests',
    );
    expect(request.headers.has('Authorization')).toBe(false);
    expect(request.headers.has('Cookie')).toBe(false);
    expect(request.headers.has('x-correlation-id')).toBe(false);
    expect(request.credentials).toBe('omit');
  });

  it('forwards only an explicitly supplied bearer token and correlation ID', async () => {
    const fetchMock = vi.fn().mockResolvedValue(accepted());
    globalThis.fetch = fetchMock;

    await createApiClient({
      baseUrl: 'https://api.example.test',
      session: { accessToken: 'server-token' },
      correlationId: 'request-123',
    }).POST('/api/v1/auth/password-recovery-requests', {
      body: { email: 'pessoa@example.com' },
      headers: {
        Authorization: 'Bearer untrusted',
        'x-correlation-id': 'untrusted',
        Cookie: 'session=unsafe',
      },
    });

    const request = fetchMock.mock.calls[0]?.[0] as Request;
    expect(request.headers.get('Authorization')).toBe('Bearer server-token');
    expect(request.headers.get('x-correlation-id')).toBe('request-123');
    expect(request.headers.has('Cookie')).toBe(false);
    expect(request.credentials).toBe('omit');
  });

  it('maps upstream errors without exposing their body', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      Response.json(
        { error: { message: 'private provider detail' } },
        {
          status: 401,
          headers: { 'x-correlation-id': 'request-123' },
        },
      ),
    );

    await expect(
      createApiClient({ baseUrl: 'https://api.example.test' }).POST(
        '/api/v1/auth/password-recovery-requests',
        { body: { email: 'pessoa@example.com' } },
      ),
    ).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
      status: 401,
      correlationId: 'request-123',
      message: 'UNAUTHENTICATED',
    } satisfies Partial<ApiClientError>);
  });

  it('maps transport failures to a safe typed error', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('private URL'));

    await expect(
      createApiClient({ baseUrl: 'https://api.example.test' }).POST(
        '/api/v1/auth/password-recovery-requests',
        { body: { email: 'pessoa@example.com' } },
      ),
    ).rejects.toMatchObject({
      code: 'API_UNAVAILABLE',
      status: 0,
      message: 'API_UNAVAILABLE',
    } satisfies Partial<ApiClientError>);
  });

  it('rejects unsafe outbound metadata', () => {
    expect(() =>
      createApiClient({
        baseUrl: 'https://api.example.test',
        session: { accessToken: 'token\r\nInjected: yes' },
      }),
    ).toThrow('Invalid API session.');
    expect(() =>
      createApiClient({ baseUrl: 'https://user:secret@api.example.test' }),
    ).toThrow('Invalid API base URL.');
    expect(() =>
      createApiClient({
        baseUrl: 'https://api.example.test',
        correlationId: 'bad\r\nvalue',
      }),
    ).toThrow('Invalid API correlation ID.');
  });
});
