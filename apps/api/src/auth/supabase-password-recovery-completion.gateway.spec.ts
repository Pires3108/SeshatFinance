import { describe, expect, it, vi } from 'vitest';

import { SupabasePasswordRecoveryCompletionGateway } from './supabase-password-recovery-completion.gateway.js';

describe('SupabasePasswordRecoveryCompletionGateway', () => {
  it('consumes a recovery token before changing the password', async () => {
    const verifyOtp = vi.fn().mockResolvedValue({
      data: { session: { access_token: 'synthetic-only' } },
      error: null,
    });
    const updateUser = vi.fn().mockResolvedValue({ error: null });
    const gateway = new SupabasePasswordRecoveryCompletionGateway(() => ({
      auth: { verifyOtp, updateUser },
    }));

    await expect(
      gateway.complete({
        tokenHash: 'synthetic-token-hash',
        password: 'new-synthetic-password',
      }),
    ).resolves.toBe(true);
    expect(verifyOtp).toHaveBeenCalledWith({
      token_hash: 'synthetic-token-hash',
      type: 'recovery',
    });
    expect(updateUser).toHaveBeenCalledWith({
      password: 'new-synthetic-password',
    });
    expect(verifyOtp.mock.invocationCallOrder[0]).toBeLessThan(
      updateUser.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
  });

  it.each(['consumed', 'expired'])(
    'rejects a %s token without changing the password',
    async () => {
      const verifyOtp = vi.fn().mockResolvedValue({
        data: { session: null },
        error: { code: 'otp_expired' },
      });
      const updateUser = vi.fn();
      const gateway = new SupabasePasswordRecoveryCompletionGateway(() => ({
        auth: { verifyOtp, updateUser },
      }));

      await expect(
        gateway.complete({
          tokenHash: 'synthetic-token-hash',
          password: 'new-synthetic-password',
        }),
      ).resolves.toBe(false);
      expect(updateUser).not.toHaveBeenCalled();
    },
  );

  it('treats a provider failure as unavailable without changing the password', async () => {
    const updateUser = vi.fn();
    const gateway = new SupabasePasswordRecoveryCompletionGateway(() => ({
      auth: {
        verifyOtp: vi.fn().mockResolvedValue({
          data: { session: null },
          error: { code: 'unexpected_failure' },
        }),
        updateUser,
      },
    }));

    await expect(
      gateway.complete({
        tokenHash: 'synthetic-token-hash',
        password: 'new-synthetic-password',
      }),
    ).rejects.toThrow('Recovery provider unavailable.');
    expect(updateUser).not.toHaveBeenCalled();
  });
});
