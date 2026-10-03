import { describe, expect, it, vi } from 'vitest';
import {
  IdentityProviderUnavailableError,
  InvalidIdentityCredentialsError,
} from '@seshat/application';

import { SupabaseIdentityAuthenticationGateway } from './supabase-identity-authentication.gateway.js';

describe('SupabaseIdentityAuthenticationGateway', () => {
  it('maps a provider session without exposing provider types', async () => {
    const signInWithPassword = vi.fn().mockResolvedValue({
      data: {
        session: {
          access_token: 'synthetic-access-token',
          expires_at: 1_799_790_000,
          refresh_token: 'synthetic-refresh-token',
          user: { id: '00000000-0000-4000-8000-000000000001' },
        },
      },
      error: null,
    });
    const gateway = new SupabaseIdentityAuthenticationGateway(() => ({
      auth: { signInWithPassword },
    }));

    const result = await gateway.authenticate({
      email: 'synthetic.user@example.test',
      password: 'synthetic-password-only-for-tests',
    });

    expect(result).toEqual({
      userId: '00000000-0000-4000-8000-000000000001',
    });
  });

  it('classifies invalid credentials without exposing provider details', async () => {
    const gateway = new SupabaseIdentityAuthenticationGateway(() => ({
      auth: {
        signInWithPassword: vi.fn().mockResolvedValue({
          data: { session: null },
          error: { code: 'invalid_credentials', message: 'provider detail' },
        }),
      },
    }));

    await expect(
      gateway.authenticate({
        email: 'synthetic.user@example.test',
        password: 'synthetic-password-only-for-tests',
      }),
    ).rejects.toBeInstanceOf(InvalidIdentityCredentialsError);
  });

  it('treats unknown provider errors as unavailable rather than failed credentials', async () => {
    const gateway = new SupabaseIdentityAuthenticationGateway(() => ({
      auth: {
        signInWithPassword: vi.fn().mockResolvedValue({
          data: { session: null },
          error: { code: 'unexpected_provider_failure' },
        }),
      },
    }));
    await expect(
      gateway.authenticate({
        email: 'synthetic.user@example.test',
        password: 'synthetic-password-only-for-tests',
      }),
    ).rejects.toBeInstanceOf(IdentityProviderUnavailableError);
  });
});
