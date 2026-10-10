import { afterEach, describe, expect, it, vi } from 'vitest';
import { POST } from './route';

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

function request(body: unknown): Request {
  return new Request('http://localhost:3000/api/auth/registrations/confirm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('registration confirmation proxy', () => {
  it('rejects missing token without forwarding', async () => {
    const mock = vi.fn();
    globalThis.fetch = mock;
    expect((await POST(request({ tokenHash: '' }))).status).toBe(400);
    expect(mock).not.toHaveBeenCalled();
  });
  it.each([
    [204, 204],
    [400, 400],
    [503, 503],
  ])('maps upstream %i to %i', async (upstream, expected) => {
    const mock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: upstream }));
    globalThis.fetch = mock;
    const response = await POST(request({ tokenHash: 'valid_hash-1' }));
    expect(response.status).toBe(expected);
    const outbound = mock.mock.calls[0]?.[0];
    expect(outbound).toBeInstanceOf(Request);
    if (!(outbound instanceof Request)) throw new Error('Missing API request.');
    expect(outbound.url).toContain('/api/v1/auth/registrations/confirm');
    expect(outbound.cache).toBe('no-store');
  });
});
