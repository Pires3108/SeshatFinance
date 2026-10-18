import { IdentityProviderUnavailableError } from '@seshat/application';
import { describe, expect, it, vi } from 'vitest';

import {
  SupabaseRegistrationConfirmationGateway,
  type SupabaseRegistrationConfirmationClient,
} from './supabase-registration-confirmation.gateway.js';

describe('Supabase registration confirmation', () => {
  it('returns a confirmed identity without returning the provider session', async () => {
    const verifyOtp = vi
      .fn<SupabaseRegistrationConfirmationClient['auth']['verifyOtp']>()
      .mockResolvedValue({
        data: {
          user: {
            id: '11111111-1111-4111-8111-111111111111',
            email: 'synthetic@example.test',
            email_confirmed_at: '2026-10-06T12:00:00Z',
            user_metadata: { display_name: ' Pessoa fictícia ' },
          },
        },
        error: null,
      });
    const gateway = new SupabaseRegistrationConfirmationGateway(() => ({
      auth: { verifyOtp },
    }));
    await expect(gateway.confirm('synthetic-token')).resolves.toEqual({
      id: '11111111-1111-4111-8111-111111111111',
      email: 'synthetic@example.test',
      displayName: 'Pessoa fictícia',
    });
    expect(verifyOtp).toHaveBeenCalledWith({
      token_hash: 'synthetic-token',
      type: 'email',
    });
  });

  it('rejects unconfirmed identities and invalid or consumed tokens', async () => {
    const verifyOtp = vi
      .fn<SupabaseRegistrationConfirmationClient['auth']['verifyOtp']>()
      .mockResolvedValueOnce({
        data: { user: null },
        error: { code: 'otp_expired' },
      })
      .mockResolvedValueOnce({
        data: {
          user: {
            id: '11111111-1111-4111-8111-111111111111',
            email: 'synthetic@example.test',
            email_confirmed_at: null,
          },
        },
        error: null,
      });
    const gateway = new SupabaseRegistrationConfirmationGateway(() => ({
      auth: { verifyOtp },
    }));
    await expect(gateway.confirm('synthetic-invalid')).resolves.toBeNull();
    await expect(gateway.confirm('synthetic-unconfirmed')).resolves.toBeNull();
  });

  it('sanitizes provider outages instead of exposing raw token or provider details', async () => {
    const verifyOtp = vi
      .fn<SupabaseRegistrationConfirmationClient['auth']['verifyOtp']>()
      .mockRejectedValue(new Error('synthetic-sensitive-marker'));
    const gateway = new SupabaseRegistrationConfirmationGateway(() => ({
      auth: { verifyOtp },
    }));
    await expect(gateway.confirm('synthetic-token')).rejects.toBeInstanceOf(
      IdentityProviderUnavailableError,
    );
    await expect(gateway.confirm('synthetic-token')).rejects.not.toThrow(
      'synthetic-sensitive-marker',
    );
  });
});
