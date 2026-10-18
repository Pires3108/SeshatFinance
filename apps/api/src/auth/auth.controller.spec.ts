import {
  ConfirmRegistrationUseCase,
  RegisterUserUseCase,
  ResendRegistrationConfirmationUseCase,
} from '@seshat/application';
import { describe, expect, it, vi } from 'vitest';

import type { AuthConfiguration } from './auth-configuration.js';
import { AuthController } from './auth.controller.js';

describe('AuthController', () => {
  it('returns the generic confirmation response after accepting registration', async () => {
    const register = vi.fn((): Promise<string | null> => Promise.resolve(null));
    const controller = new AuthController(
      new RegisterUserUseCase(
        { register },
        { recordIntent: vi.fn(), createPending: vi.fn() },
        { isCompromised: () => Promise.resolve(false) },
      ),
      {
        read: () => ({
          confirmationRedirectUrl: 'https://app.example.test/auth/confirm',
          supabasePublishableKey: 'synthetic-publishable-key',
          supabaseUrl: 'https://synthetic-project.supabase.co',
        }),
        readPasswordRecoveryRedirectUrl: () =>
          'https://app.example.test/auth/reset-password',
        readIntentHmacKey: () => Buffer.alloc(32, 7).toString('base64url'),
      } satisfies AuthConfiguration,
      new ConfirmRegistrationUseCase(
        { confirm: vi.fn().mockResolvedValue(null) },
        { ready: vi.fn(), ensure: vi.fn() },
        { now: (): Date => new Date() },
      ),
      new ResendRegistrationConfirmationUseCase({ resend: vi.fn() }),
    );

    const result = await controller.register({
      displayName: 'Pessoa Teste',
      email: 'synthetic.user@example.test',
      password: 'synthetic-password-only-for-tests',
    });

    expect(result).toEqual({ status: 'confirmation_required' });
    expect(register).toHaveBeenCalledWith({
      confirmationRedirectUrl: 'https://app.example.test/auth/confirm',
      displayName: 'Pessoa Teste',
      email: 'synthetic.user@example.test',
      password: 'synthetic-password-only-for-tests',
    });
  });
});
