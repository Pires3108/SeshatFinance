import { afterEach, describe, expect, it, vi } from 'vitest';
import { POST } from './route';

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

function request(body: unknown): Request {
  return new Request('http://localhost:3000/api/auth/registrations/resend', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('registration confirmation resend proxy', () => {
  it('rejects invalid email without forwarding', async () => {
    const mock = vi.fn();
    globalThis.fetch = mock;
    expect((await POST(request({ email: 'invalid' }))).status).toBe(400);
    expect(mock).not.toHaveBeenCalled();
  });
  it('returns generic success without exposing upstream data', async () => {
    const mock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        Response.json(
          { status: 'confirmation_required', private: 'secret' },
          { status: 202 },
        ),
      );
    globalThis.fetch = mock;
    const response = await POST(request({ email: 'pessoa@example.com' }));
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ status: 'confirmation_required' });
    const outbound = mock.mock.calls[0]?.[0];
    expect(outbound).toBeInstanceOf(Request);
    if (!(outbound instanceof Request)) throw new Error('Missing API request.');
    expect(outbound.url).toContain('/api/v1/auth/registrations/resend');
  });
});
