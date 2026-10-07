import { describe, expect, it, vi } from 'vitest';

import {
  InvalidIdentityTokenError,
  SupabaseIdentityTokenVerifier,
} from './supabase-identity-token-verifier.js';

describe('SupabaseIdentityTokenVerifier', () => {
  it('uses the remotely verified provider user as the actor', async () => {
    const getUser = vi.fn().mockResolvedValue({
      data: { user: { id: '00000000-0000-4000-8000-000000000001' } },
      error: null,
    });
    const verifier = new SupabaseIdentityTokenVerifier(() => ({
      auth: { getUser },
    }));

    await expect(verifier.verify('synthetic-access-token')).resolves.toEqual({
      id: '00000000-0000-4000-8000-000000000001',
    });
    expect(getUser).toHaveBeenCalledWith('synthetic-access-token');
  });

  it('rejects missing or invalid provider users uniformly', async () => {
    const verifier = new SupabaseIdentityTokenVerifier(() => ({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: null },
          error: new Error('provider detail'),
        }),
      },
    }));

    await expect(verifier.verify('invalid-token')).rejects.toBeInstanceOf(
      InvalidIdentityTokenError,
    );
  });

  it('exposes only a provider-confirmed normalized email', async () => {
    const getUser = vi.fn().mockResolvedValue({
      data: {
        user: {
          id: 'actor-id',
          email: '  Person@Example.COM  ',
          email_confirmed_at: '2026-10-06T10:00:00.000Z',
        },
      },
      error: null,
    });
    const verifier = new SupabaseIdentityTokenVerifier(() => ({
      auth: { getUser },
    }));

    await expect(verifier.verify('access-token')).resolves.toEqual({
      id: 'actor-id',
      confirmedEmail: 'person@example.com',
    });
  });

  it.each([null, undefined, '', 'invalid'])(
    'omits unconfirmed email (%s)',
    async (confirmedAt) => {
      const verifier = new SupabaseIdentityTokenVerifier(() => ({
        auth: {
          getUser: vi.fn().mockResolvedValue({
            data: {
              user: {
                id: 'actor-id',
                email: 'person@example.com',
                email_confirmed_at: confirmedAt,
              },
            },
            error: null,
          }),
        },
      }));

      await expect(verifier.verify('access-token')).resolves.toEqual({
        id: 'actor-id',
      });
    },
  );

  it('omits malformed provider email even when confirmation exists', async () => {
    const verifier = new SupabaseIdentityTokenVerifier(() => ({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: {
            user: {
              id: 'actor-id',
              email: 'not-an-email',
              email_confirmed_at: '2026-10-06T10:00:00.000Z',
            },
          },
          error: null,
        }),
      },
    }));

    await expect(verifier.verify('access-token')).resolves.toEqual({
      id: 'actor-id',
    });
  });
});
