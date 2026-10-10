import { describe, expect, it, vi } from 'vitest';

import {
  RegisterUserUseCase,
  type IdentityRegistrationGateway,
  type RegisterUserCommand,
} from './register-user.js';

describe('RegisterUserUseCase', () => {
  it('delegates registration without handling the password itself', async () => {
    const register = vi
      .fn<IdentityRegistrationGateway['register']>()
      .mockResolvedValue('11111111-1111-4111-8111-111111111111');
    const recordIntent = vi.fn().mockResolvedValue(undefined);
    const createPending = vi.fn().mockResolvedValue(undefined);
    const command: RegisterUserCommand = {
      displayName: 'Pessoa Teste',
      email: 'synthetic.user@example.test',
      password: 'synthetic-password-only-for-tests',
      confirmationRedirectUrl: 'https://app.example.test/auth/confirm',
    };

    await new RegisterUserUseCase(
      { register },
      { recordIntent, createPending },
    ).execute(command);

    expect(register).toHaveBeenCalledOnce();
    expect(register).toHaveBeenCalledWith(command);
    expect(recordIntent).toHaveBeenCalledWith(command.email);
    expect(createPending).toHaveBeenCalledWith(
      '11111111-1111-4111-8111-111111111111',
      command.displayName,
    );
  });

  it('does not create a local profile when provider registration fails', async () => {
    const createPending = vi.fn();
    const useCase = new RegisterUserUseCase(
      {
        register: vi.fn().mockRejectedValue(new Error('provider unavailable')),
      },
      { recordIntent: vi.fn(), createPending },
    );
    await expect(
      useCase.execute({
        displayName: 'Pessoa',
        email: 'synthetic@example.test',
        password: 'synthetic',
        confirmationRedirectUrl: 'https://example.test/confirm',
      }),
    ).rejects.toThrow();
    expect(createPending).not.toHaveBeenCalled();
  });
});
