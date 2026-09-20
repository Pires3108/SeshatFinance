import { RegisterUserUseCase } from '@seshat/application';
import { describe, expect, it, vi } from 'vitest';

import type { AuthConfiguration } from './auth-configuration.js';
import { AuthController } from './auth.controller.js';

describe('AuthController', () => {
  it('returns the generic confirmation response after accepting registration', async () => {
    const execute = vi.fn<RegisterUserUseCase['execute']>();
    const controller = new AuthController(
      new RegisterUserUseCase({ register: execute }),
      {
        read: () => ({
          confirmationRedirectUrl: 'https://app.example.test/auth/confirm',
          supabasePublishableKey: 'synthetic-publishable-key',
          supabaseUrl: 'https://synthetic-project.supabase.co',
        }),
        readPasswordRecoveryRedirectUrl: () =>
          'https://app.example.test/auth/reset-password',
      } satisfies AuthConfiguration,
    );

    const result = await controller.register({
      displayName: 'Pessoa Teste',
      email: 'synthetic.user@example.test',
      password: 'synthetic-password-only-for-tests',
    });

    expect(result).toEqual({ status: 'confirmation_required' });
    expect(execute).toHaveBeenCalledWith({
      confirmationRedirectUrl: 'https://app.example.test/auth/confirm',
      displayName: 'Pessoa Teste',
      email: 'synthetic.user@example.test',
      password: 'synthetic-password-only-for-tests',
    });
  });
});
