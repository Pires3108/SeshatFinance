import { describe, expect, it, vi } from 'vitest';

import {
  RegisterUserUseCase,
  type IdentityRegistrationGateway,
  type RegisterUserCommand,
} from './register-user.js';

describe('RegisterUserUseCase', () => {
  it('delegates registration without handling the password itself', async () => {
    const register = vi.fn<IdentityRegistrationGateway['register']>();
    const command: RegisterUserCommand = {
      displayName: 'Pessoa Teste',
      email: 'synthetic.user@example.test',
      password: 'synthetic-password-only-for-tests',
      confirmationRedirectUrl: 'https://app.example.test/auth/confirm',
    };

    await new RegisterUserUseCase({ register }).execute(command);

    expect(register).toHaveBeenCalledOnce();
    expect(register).toHaveBeenCalledWith(command);
  });
});
