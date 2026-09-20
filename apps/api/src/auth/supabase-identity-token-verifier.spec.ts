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
});
