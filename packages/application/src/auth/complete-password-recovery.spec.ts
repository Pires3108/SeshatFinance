import { describe, expect, it, vi } from 'vitest';

import { CompletePasswordRecoveryUseCase } from './complete-password-recovery.js';
import type { LoginAttemptRepository } from './authenticate-user.js';
import type { OpaqueSessionService } from './opaque-session.js';

describe('CompletePasswordRecoveryUseCase', () => {
  it('does not consume a one-use provider token when session storage is unavailable', async () => {
    const complete = vi.fn();
    const sessions = {
      ready: () => Promise.reject(new Error('database unavailable')),
    } as unknown as OpaqueSessionService;
    const attempts = {
      runExclusive: vi.fn(),
    } as unknown as LoginAttemptRepository;
    const useCase = new CompletePasswordRecoveryUseCase(
      { complete },
      sessions,
      attempts,
      { isCompromised: () => Promise.resolve(false) },
    );

    await expect(useCase.execute('proof', 'new-password')).rejects.toThrow(
      'database unavailable',
    );
    expect(complete).not.toHaveBeenCalled();
  });

  it('checks the password only through the gateway after proof validation', async () => {
    const complete = vi.fn(
      async (
        _tokenHash: string,
        _password: string,
        _revokeSessions: (userId: string) => Promise<void>,
        _runExclusive: (
          email: string,
          action: () => Promise<void>,
        ) => Promise<void>,
        checkPassword: () => Promise<void>,
      ): Promise<void> => checkPassword(),
    );
    const sessions = {
      ready: () => Promise.resolve(),
    } as unknown as OpaqueSessionService;
    const attempts = {
      runExclusive: vi.fn(),
    } as unknown as LoginAttemptRepository;
    const useCase = new CompletePasswordRecoveryUseCase(
      { complete },
      sessions,
      attempts,
      { isCompromised: () => Promise.resolve(true) },
    );
    await expect(
      useCase.execute('proof', 'known-compromised-password'),
    ).rejects.toThrow('Password does not meet');
    expect(complete).toHaveBeenCalledOnce();
  });
});
