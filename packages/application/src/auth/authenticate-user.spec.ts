import { describe, expect, it, vi } from 'vitest';

import {
  AuthenticateUserUseCase,
  IdentityCredentialsRejectedError,
  type IdentityAuthenticationGateway,
  type IdentitySession,
  type LoginAttemptRepository,
} from './authenticate-user.js';

describe('AuthenticateUserUseCase', () => {
  it('blocks a locked origin across identities and counts rejected credentials', async () => {
    const authenticate = vi
      .fn()
      .mockRejectedValue(new IdentityCredentialsRejectedError());
    const recordFailure = vi.fn().mockResolvedValue(undefined);
    let locked = false;
    const attempts: LoginAttemptRepository = {
      runExclusive: async (_email, action) =>
        action({
          isLocked: () => Promise.resolve(false),
          recordFailure: () => Promise.resolve(),
          clear: () => Promise.resolve(),
        }),
    };
    const useCase = new AuthenticateUserUseCase(
      { authenticate },
      attempts,
      { now: () => new Date('2026-10-13T12:00:00Z') },
      {
        reserve: () => Promise.resolve(locked ? null : 'reservation'),
        finish: async (_origin, _reservation, failed) => {
          if (failed) {
            await recordFailure();
            locked = true;
          }
        },
      },
    );
    await expect(
      useCase.execute({
        email: 'first@example.test',
        password: 'bad',
        origin: '192.0.2.1',
      }),
    ).rejects.toThrow('Authentication was not accepted.');
    await expect(
      useCase.execute({
        email: 'second@example.test',
        password: 'bad',
        origin: '192.0.2.1',
      }),
    ).rejects.toThrow('Authentication was not accepted.');
    expect(authenticate).toHaveBeenCalledOnce();
    expect(recordFailure).toHaveBeenCalledOnce();
  });

  it('does not count a provider outage as a credential failure', async () => {
    const finish = vi.fn();
    const recordFailure = vi.fn();
    const useCase = new AuthenticateUserUseCase(
      { authenticate: () => Promise.reject(new Error('provider unavailable')) },
      {
        runExclusive: async (_email, action) =>
          action({
            isLocked: () => Promise.resolve(false),
            recordFailure,
            clear: () => Promise.resolve(),
          }),
      },
      { now: () => new Date('2026-10-13T12:00:00Z') },
      { reserve: () => Promise.resolve('reservation'), finish },
    );
    await expect(
      useCase.execute({
        email: 'first@example.test',
        password: 'bad',
        origin: '192.0.2.1',
      }),
    ).rejects.toThrow('provider unavailable');
    expect(recordFailure).not.toHaveBeenCalled();
    expect(finish).toHaveBeenCalledWith(
      '192.0.2.1',
      'reservation',
      false,
      expect.any(Date),
    );
  });
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

  it('keeps session issuance inside the identity lock', async () => {
    let lockHeld = false;
    const attempts: LoginAttemptRepository = {
      runExclusive: async (_email, action) => {
        lockHeld = true;
        try {
          return await action({
            isLocked: () => Promise.resolve(false),
            recordFailure: () => Promise.resolve(),
            clear: () => Promise.resolve(),
          });
        } finally {
          lockHeld = false;
        }
      },
    };
    const useCase = new AuthenticateUserUseCase(
      { authenticate: () => Promise.resolve({ userId: 'user-id' }) },
      attempts,
      { now: () => new Date() },
    );
    await useCase.executeWith(
      { email: 'synthetic@example.test', password: 'old-password' },
      () => {
        expect(lockHeld).toBe(true);
        return Promise.resolve('session-token');
      },
    );
    expect(lockHeld).toBe(false);
  });
});
