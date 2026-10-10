import { describe, expect, it, vi } from 'vitest';

import {
  AuthenticateUserUseCase,
  type IdentityAuthenticationGateway,
  type IdentitySession,
  type LoginAttemptRepository,
} from './authenticate-user.js';

describe('AuthenticateUserUseCase', () => {
  it('delegates credentials to the identity boundary', async () => {
    const session: IdentitySession = {
      userId: '00000000-0000-4000-8000-000000000001',
    };
    const authenticate = vi
      .fn<IdentityAuthenticationGateway['authenticate']>()
      .mockResolvedValue(session);

    const attempts: LoginAttemptRepository = {
      runExclusive: async (_email, action) =>
        action({
          isLocked: vi.fn().mockResolvedValue(false),
          recordFailure: vi.fn().mockResolvedValue(undefined),
          clear: vi.fn().mockResolvedValue(undefined),
        }),
    };
    const result = await new AuthenticateUserUseCase(
      { authenticate },
      attempts,
      { now: () => new Date() },
    ).execute({
      email: 'synthetic.user@example.test',
      password: 'synthetic-password-only-for-tests',
    });

    expect(result).toBe(session);
    expect(authenticate).toHaveBeenCalledOnce();
  });

  it('rejects a locked identity before calling the provider', async () => {
    const authenticate = vi.fn<IdentityAuthenticationGateway['authenticate']>();
    const attempts: LoginAttemptRepository = {
      runExclusive: async (_email, action) =>
        action({
          isLocked: vi.fn().mockResolvedValue(true),
          recordFailure: vi.fn().mockResolvedValue(undefined),
          clear: vi.fn().mockResolvedValue(undefined),
        }),
    };
    await expect(
      new AuthenticateUserUseCase({ authenticate }, attempts, {
        now: () => new Date(),
      }).execute({ email: 'synthetic@example.test', password: 'bad' }),
    ).rejects.toThrow('Authentication was not accepted.');
    expect(authenticate).not.toHaveBeenCalled();
  });
});
