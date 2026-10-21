import { describe, expect, it, vi } from 'vitest';
import { PasswordRejectedError } from '@seshat/application';

import {
  IdentityRegistrationError,
  SupabaseIdentityRegistrationGateway,
} from './supabase-identity-registration.gateway.js';

describe('SupabaseIdentityRegistrationGateway', () => {
  it('requests email confirmation with only the required profile metadata', async () => {
    const signUp = vi.fn().mockResolvedValue({
      data: {
        user: {
          id: '11111111-1111-4111-8111-111111111111',
          identities: [{}],
        },
      },
      error: null,
    });
    const gateway = new SupabaseIdentityRegistrationGateway(() => ({
      auth: { signUp },
    }));

    await gateway.register({
      displayName: 'Pessoa Teste',
      email: 'synthetic.user@example.test',
      password: 'synthetic-password-only-for-tests',
      confirmationRedirectUrl: 'https://app.example.test/auth/confirm',
    });

    expect(signUp).toHaveBeenCalledWith({
      email: 'synthetic.user@example.test',
      password: 'synthetic-password-only-for-tests',
      options: {
        data: { display_name: 'Pessoa Teste' },
        emailRedirectTo: 'https://app.example.test/auth/confirm',
      },
    });
  });

  it('does not leak provider errors through the application boundary', async () => {
    const gateway = new SupabaseIdentityRegistrationGateway(() => ({
      auth: {
        signUp: vi.fn().mockResolvedValue({
          data: {},
          error: new Error('provider detail'),
        }),
      },
    }));

    await expect(
      gateway.register({
        displayName: 'Pessoa Teste',
        email: 'synthetic.user@example.test',
        password: 'synthetic-password-only-for-tests',
        confirmationRedirectUrl: 'https://app.example.test/auth/confirm',
      }),
    ).rejects.toBeInstanceOf(IdentityRegistrationError);
  });

  it('treats an existing identity as an accepted registration without exposing its existence', async () => {
    const gateway = new SupabaseIdentityRegistrationGateway(() => ({
      auth: {
        signUp: vi.fn().mockResolvedValue({
          data: { user: null },
          error: { code: 'user_already_exists' },
        }),
      },
    }));
    await expect(
      gateway.register({
        displayName: 'Pessoa Teste',
        email: 'synthetic.user@example.test',
        password: 'synthetic-password-only-for-tests',
        confirmationRedirectUrl: 'https://app.example.test/auth/confirm',
      }),
    ).resolves.toBeNull();
  });

  it('maps provider weak or breached password rejection without exposing details', async () => {
    const gateway = new SupabaseIdentityRegistrationGateway(() => ({
      auth: {
        signUp: vi.fn().mockResolvedValue({
          data: { user: null },
          error: { code: 'weak_password', detail: 'private' },
        }),
      },
    }));
    await expect(
      gateway.register({
        displayName: 'Pessoa Teste',
        email: 'synthetic.user@example.test',
        password: 'synthetic-password-only-for-tests',
        confirmationRedirectUrl: 'https://app.example.test/auth/confirm',
      }),
    ).rejects.toBeInstanceOf(PasswordRejectedError);
  });
});
