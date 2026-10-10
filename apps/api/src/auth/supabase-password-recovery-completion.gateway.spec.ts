import {
  AuthenticateUserUseCase,
  IdentityProviderUnavailableError,
  InvalidRecoveryTokenError,
  PasswordRejectedError,
  type LoginAttemptRepository,
} from '@seshat/application';
import { describe, expect, it, vi } from 'vitest';

import { SupabasePasswordRecoveryCompletionGateway } from './supabase-password-recovery-completion.gateway.js';

const userId = '813b6f6a-fde1-4762-ad9b-74b609729a7a';
const email = 'synthetic@example.test';
const exclusive = (
  _email: string,
  action: () => Promise<void>,
): Promise<void> => action();
const safePassword = (): Promise<void> => Promise.resolve();

describe('Supabase password recovery completion', () => {
  it('cannot leave an old-password login session active across recovery', async () => {
    const events: string[] = [];
    let releaseAuthentication!: () => void;
    const authenticationPaused = new Promise<void>((resolve) => {
      releaseAuthentication = resolve;
    });
    let signalLoginEntered!: () => void;
    const loginEntered = new Promise<void>((resolve) => {
      signalLoginEntered = resolve;
    });
    let queue = Promise.resolve();
    const lock = async <T>(action: () => Promise<T>): Promise<T> => {
      const previous = queue;
      let release!: () => void;
      queue = new Promise<void>((resolve) => {
        release = resolve;
      });
      await previous;
      try {
        return await action();
      } finally {
        release();
      }
    };
    const attempts: LoginAttemptRepository = {
      runExclusive: (lockedEmail, action) => {
        expect(lockedEmail).toBe(email);
        return lock(() =>
          action({
            isLocked: () => Promise.resolve(false),
            recordFailure: () => Promise.resolve(),
            clear: () => Promise.resolve(),
          }),
        );
      },
    };
    const login = new AuthenticateUserUseCase(
      {
        authenticate: async () => {
          signalLoginEntered();
          await authenticationPaused;
          return { userId };
        },
      },
      attempts,
      { now: () => new Date() },
    );
    const gateway = new SupabasePasswordRecoveryCompletionGateway(() => ({
      auth: {
        verifyOtp: () =>
          Promise.resolve({
            data: { user: { id: userId, email } },
            error: null,
          }),
        updateUser: () => {
          events.push('password-updated');
          return Promise.resolve({ error: null });
        },
      },
    }));
    const loginResult = login.executeWith(
      { email, password: 'old-password' },
      () => {
        events.push('session-issued');
        return Promise.resolve();
      },
    );
    await loginEntered;
    const recoveryResult = gateway.complete(
      'proof',
      'new-password',
      () => {
        events.push('sessions-revoked');
        return Promise.resolve();
      },
      (identityEmail, action) => {
        expect(identityEmail).toBe(email);
        return attempts.runExclusive(identityEmail, () => action());
      },
      safePassword,
    );
    releaseAuthentication();
    await Promise.all([loginResult, recoveryResult]);
    expect(events).toEqual([
      'session-issued',
      'sessions-revoked',
      'password-updated',
      'sessions-revoked',
    ]);
  });

  it('makes an old-password login wait for an in-progress recovery', async () => {
    let releaseUpdate!: () => void;
    const updatePaused = new Promise<void>((resolve) => {
      releaseUpdate = resolve;
    });
    let signalUpdateEntered!: () => void;
    const updateEntered = new Promise<void>((resolve) => {
      signalUpdateEntered = resolve;
    });
    let queue = Promise.resolve();
    const lock = async <T>(action: () => Promise<T>): Promise<T> => {
      const previous = queue;
      let release!: () => void;
      queue = new Promise<void>((resolve) => {
        release = resolve;
      });
      await previous;
      try {
        return await action();
      } finally {
        release();
      }
    };
    let currentPassword = 'old-password';
    const attempts: LoginAttemptRepository = {
      runExclusive: (lockedEmail, action) => {
        expect(lockedEmail).toBe(email);
        return lock(() =>
          action({
            isLocked: () => Promise.resolve(false),
            recordFailure: () => Promise.resolve(),
            clear: () => Promise.resolve(),
          }),
        );
      },
    };
    const gateway = new SupabasePasswordRecoveryCompletionGateway(() => ({
      auth: {
        verifyOtp: () =>
          Promise.resolve({
            data: { user: { id: userId, email } },
            error: null,
          }),
        updateUser: async ({ password }) => {
          signalUpdateEntered();
          await updatePaused;
          currentPassword = password;
          return { error: null };
        },
      },
    }));
    const recovery = gateway.complete(
      'proof',
      'new-password',
      () => Promise.resolve(),
      (identityEmail, action) => {
        expect(identityEmail).toBe(email);
        return attempts.runExclusive(identityEmail, () => action());
      },
      safePassword,
    );
    await updateEntered;
    const authenticate = vi.fn(({ password }: { password: string }) =>
      password === currentPassword
        ? Promise.resolve({ userId })
        : Promise.reject(new Error('invalid credentials')),
    );
    const login = new AuthenticateUserUseCase({ authenticate }, attempts, {
      now: () => new Date(),
    });
    const loginResult = login.executeWith(
      { email, password: 'old-password' },
      () => Promise.resolve(),
    );
    expect(authenticate).not.toHaveBeenCalled();
    releaseUpdate();
    await recovery;
    await expect(loginResult).rejects.toThrow(
      'Authentication was not accepted.',
    );
    expect(authenticate).toHaveBeenCalledOnce();
  });

  it('verifies the recovery proof, revokes sessions around the password change, and returns no provider session', async () => {
    const calls: string[] = [];
    const verifyOtp = vi.fn(() => {
      calls.push('verify');
      return Promise.resolve({
        data: { user: { id: userId, email } },
        error: null,
      });
    });
    const updateUser = vi.fn(() => {
      calls.push('update');
      return Promise.resolve({ error: null });
    });
    const revoke = vi.fn(() => {
      calls.push('revoke');
      return Promise.resolve();
    });
    const gateway = new SupabasePasswordRecoveryCompletionGateway(() => ({
      auth: { verifyOtp, updateUser },
    }));

    await gateway.complete(
      'hash',
      'new password',
      revoke,
      exclusive,
      safePassword,
    );

    expect(verifyOtp).toHaveBeenCalledWith({
      token_hash: 'hash',
      type: 'recovery',
    });
    expect(updateUser).toHaveBeenCalledWith({ password: 'new password' });
    expect(revoke).toHaveBeenNthCalledWith(1, userId);
    expect(calls).toEqual(['verify', 'revoke', 'update', 'revoke']);
  });

  it('does not change a password for an expired proof', async () => {
    const updateUser = vi.fn();
    const revoke = vi.fn();
    const checkPassword = vi.fn(() => Promise.resolve());
    const gateway = new SupabasePasswordRecoveryCompletionGateway(() => ({
      auth: {
        verifyOtp: () =>
          Promise.resolve({
            data: { user: null },
            error: { code: 'otp_expired' },
          }),
        updateUser,
      },
    }));
    await expect(
      gateway.complete(
        'expired',
        'new password',
        revoke,
        exclusive,
        checkPassword,
      ),
    ).rejects.toBeInstanceOf(InvalidRecoveryTokenError);
    expect(updateUser).not.toHaveBeenCalled();
    expect(revoke).not.toHaveBeenCalled();
    expect(checkPassword).not.toHaveBeenCalled();
  });

  it('checks password after valid proof and before revoking sessions or updating it', async () => {
    const calls: string[] = [];
    const gateway = new SupabasePasswordRecoveryCompletionGateway(() => ({
      auth: {
        verifyOtp: () => {
          calls.push('verify');
          return Promise.resolve({
            data: { user: { id: userId, email } },
            error: null,
          });
        },
        updateUser: () => {
          calls.push('update');
          return Promise.resolve({ error: null });
        },
      },
    }));
    await expect(
      gateway.complete(
        'proof',
        'compromised-password',
        () => {
          calls.push('revoke');
          return Promise.resolve();
        },
        exclusive,
        () => {
          calls.push('check');
          return Promise.reject(new PasswordRejectedError());
        },
      ),
    ).rejects.toBeInstanceOf(PasswordRejectedError);
    expect(calls).toEqual(['verify', 'check']);
  });

  it('accepts only the first use of a recovery proof', async () => {
    let consumed = false;
    const updateUser = vi.fn(() => Promise.resolve({ error: null }));
    const gateway = new SupabasePasswordRecoveryCompletionGateway(() => ({
      auth: {
        verifyOtp: () => {
          if (consumed)
            return Promise.resolve({
              data: { user: null },
              error: { code: 'otp_expired' },
            });
          consumed = true;
          return Promise.resolve({
            data: { user: { id: userId, email } },
            error: null,
          });
        },
        updateUser,
      },
    }));
    await gateway.complete(
      'hash',
      'new password',
      () => Promise.resolve(),
      exclusive,
      safePassword,
    );
    await expect(
      gateway.complete(
        'hash',
        'another password',
        () => Promise.resolve(),
        exclusive,
        safePassword,
      ),
    ).rejects.toBeInstanceOf(InvalidRecoveryTokenError);
    expect(updateUser).toHaveBeenCalledTimes(1);
  });

  it('fails closed when local sessions cannot be revoked', async () => {
    const updateUser = vi.fn();
    const gateway = new SupabasePasswordRecoveryCompletionGateway(() => ({
      auth: {
        verifyOtp: () =>
          Promise.resolve({
            data: { user: { id: userId, email } },
            error: null,
          }),
        updateUser,
      },
    }));
    await expect(
      gateway.complete(
        'hash',
        'new password',
        () => Promise.reject(new Error('database unavailable')),
        exclusive,
        safePassword,
      ),
    ).rejects.toThrow('database unavailable');
    expect(updateUser).not.toHaveBeenCalled();
  });

  it('does not leak provider errors', async () => {
    const gateway = new SupabasePasswordRecoveryCompletionGateway(() => ({
      auth: {
        verifyOtp: () =>
          Promise.resolve({
            data: { user: null },
            error: { code: 'server_error', detail: 'sensitive' },
          }),
        updateUser: () => Promise.resolve({ error: null }),
      },
    }));
    await expect(
      gateway.complete(
        'hash',
        'new password',
        () => Promise.resolve(),
        exclusive,
        safePassword,
      ),
    ).rejects.toBeInstanceOf(IdentityProviderUnavailableError);
  });

  it('maps provider weak or breached password rejection after token consumption', async () => {
    const gateway = new SupabasePasswordRecoveryCompletionGateway(() => ({
      auth: {
        verifyOtp: () =>
          Promise.resolve({
            data: { user: { id: userId, email } },
            error: null,
          }),
        updateUser: () =>
          Promise.resolve({
            error: { code: 'weak_password', detail: 'private' },
          }),
      },
    }));
    await expect(
      gateway.complete(
        'hash',
        'compromised-password',
        () => Promise.resolve(),
        exclusive,
        safePassword,
      ),
    ).rejects.toBeInstanceOf(PasswordRejectedError);
  });
});
