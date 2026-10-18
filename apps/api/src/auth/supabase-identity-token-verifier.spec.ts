import { describe, expect, it, vi } from 'vitest';

import {
  InvalidIdentityTokenError,
  SupabaseIdentityTokenVerifier,
} from './supabase-identity-token-verifier.js';

describe('SupabaseIdentityTokenVerifier', () => {
  it('uses the remotely verified provider user as the actor', async () => {
    const getUser = vi.fn().mockResolvedValue({
      data: {
        user: {
          id: '00000000-0000-4000-8000-000000000001',
          email: 'synthetic@example.test',
          email_confirmed_at: '2026-10-09T12:00:00Z',
        },
      },
      error: null,
    });
    const verifier = new SupabaseIdentityTokenVerifier(
      () => ({
        auth: { getUser },
      }),
      { ensure: vi.fn(), exists: vi.fn().mockResolvedValue(true) },
      { now: (): Date => new Date() },
    );

    await expect(verifier.verify('synthetic-access-token')).resolves.toEqual({
      id: '00000000-0000-4000-8000-000000000001',
    });
    expect(getUser).toHaveBeenCalledWith('synthetic-access-token');
  });

  it('rejects missing or invalid provider users uniformly', async () => {
    const verifier = new SupabaseIdentityTokenVerifier(
      () => ({
        auth: {
          getUser: vi.fn().mockResolvedValue({
            data: { user: null },
            error: new Error('provider detail'),
          }),
        },
      }),
      { ensure: vi.fn(), exists: vi.fn().mockResolvedValue(false) },
      { now: (): Date => new Date() },
    );

    await expect(verifier.verify('invalid-token')).rejects.toBeInstanceOf(
      InvalidIdentityTokenError,
    );
  });

  it('denies a provider-confirmed user without a local registration link', async () => {
    const ensure = vi.fn().mockRejectedValue(new Error('missing intent'));
    const verifier = new SupabaseIdentityTokenVerifier(
      () => ({
        auth: {
          getUser: vi.fn().mockResolvedValue({
            data: {
              user: {
                id: '11111111-1111-4111-8111-111111111111',
                email: 'synthetic@example.test',
                email_confirmed_at: '2026-10-09T12:00:00Z',
              },
            },
            error: null,
          }),
        },
      }),
      { ensure, exists: vi.fn().mockResolvedValue(false) },
      { now: (): Date => new Date('2026-10-09T12:00:00Z') },
    );
    await expect(verifier.verify('synthetic-token')).rejects.toBeInstanceOf(
      InvalidIdentityTokenError,
    );
  });
});
