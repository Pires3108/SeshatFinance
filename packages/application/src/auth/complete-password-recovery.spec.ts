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
    );

    await expect(useCase.execute('proof', 'new-password')).rejects.toThrow(
      'database unavailable',
    );
    expect(complete).not.toHaveBeenCalled();
  });
});
