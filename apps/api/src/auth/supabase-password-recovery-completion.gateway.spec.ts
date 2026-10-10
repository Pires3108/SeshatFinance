import {
  IdentityProviderUnavailableError,
  InvalidRecoveryTokenError,
} from '@seshat/application';
import { describe, expect, it, vi } from 'vitest';

import { SupabasePasswordRecoveryCompletionGateway } from './supabase-password-recovery-completion.gateway.js';

const userId = '813b6f6a-fde1-4762-ad9b-74b609729a7a';

describe('Supabase password recovery completion', () => {
  it('verifies the recovery proof, revokes sessions around the password change, and returns no provider session', async () => {
    const calls: string[] = [];
    const verifyOtp = vi.fn(() => {
      calls.push('verify');
      return Promise.resolve({ data: { user: { id: userId } }, error: null });
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

    await gateway.complete('hash', 'new password', revoke);

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
      gateway.complete('expired', 'new password', revoke),
    ).rejects.toBeInstanceOf(InvalidRecoveryTokenError);
    expect(updateUser).not.toHaveBeenCalled();
    expect(revoke).not.toHaveBeenCalled();
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
            data: { user: { id: userId } },
            error: null,
          });
        },
        updateUser,
      },
    }));
    await gateway.complete('hash', 'new password', () => Promise.resolve());
    await expect(
      gateway.complete('hash', 'another password', () => Promise.resolve()),
    ).rejects.toBeInstanceOf(InvalidRecoveryTokenError);
    expect(updateUser).toHaveBeenCalledTimes(1);
  });

  it('fails closed when local sessions cannot be revoked', async () => {
    const updateUser = vi.fn();
    const gateway = new SupabasePasswordRecoveryCompletionGateway(() => ({
      auth: {
        verifyOtp: () =>
          Promise.resolve({
            data: { user: { id: userId } },
            error: null,
          }),
        updateUser,
      },
    }));
    await expect(
      gateway.complete('hash', 'new password', () =>
        Promise.reject(new Error('database unavailable')),
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
      gateway.complete('hash', 'new password', () => Promise.resolve()),
    ).rejects.toBeInstanceOf(IdentityProviderUnavailableError);
  });
});
