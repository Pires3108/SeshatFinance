import { describe, expect, it, vi } from 'vitest';

import {
  IdentityRegistrationError,
  SupabaseIdentityRegistrationGateway,
} from './supabase-identity-registration.gateway.js';

describe('SupabaseIdentityRegistrationGateway', () => {
  it('requests email confirmation with only the required profile metadata', async () => {
    const signUp = vi.fn().mockResolvedValue({ data: {}, error: null });
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
});
