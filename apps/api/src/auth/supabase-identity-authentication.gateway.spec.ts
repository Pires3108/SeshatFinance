import { describe, expect, it, vi } from 'vitest';

import {
  IdentityAuthenticationError,
  SupabaseIdentityAuthenticationGateway,
} from './supabase-identity-authentication.gateway.js';

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
    const gateway = new SupabaseIdentityAuthenticationGateway(
      () => ({ auth: { signInWithPassword } }),
      () => Promise.resolve({ id: '00000000-0000-4000-8000-000000000001' }),
    );

    const result = await gateway.authenticate({
      email: 'synthetic.user@example.test',
      password: 'synthetic-password-only-for-tests',
    });

    expect(result).toEqual({
      userId: '00000000-0000-4000-8000-000000000001',
    });
  });

  it('uses one generic error for invalid credentials or missing sessions', async () => {
    const gateway = new SupabaseIdentityAuthenticationGateway(
      () => ({
        auth: {
          signInWithPassword: vi.fn().mockResolvedValue({
            data: { session: null },
            error: new Error('provider detail'),
          }),
        },
      }),
      () => Promise.resolve({ id: '00000000-0000-4000-8000-000000000001' }),
    );

    await expect(
      gateway.authenticate({
        email: 'synthetic.user@example.test',
        password: 'synthetic-password-only-for-tests',
      }),
    ).rejects.toBeInstanceOf(IdentityAuthenticationError);
  });

  it('rejects a provider session when confirmation or local profile verification fails', async () => {
    const gateway = new SupabaseIdentityAuthenticationGateway(
      () => ({
        auth: {
          signInWithPassword: vi.fn().mockResolvedValue({
            data: { session: { access_token: 'synthetic-provider-token' } },
            error: null,
          }),
        },
      }),
      () => Promise.reject(new Error('Unconfirmed or pending identity.')),
    );
    await expect(
      gateway.authenticate({
        email: 'synthetic@example.test',
        password: 'synthetic-password',
      }),
    ).rejects.toBeInstanceOf(IdentityAuthenticationError);
  });
});
