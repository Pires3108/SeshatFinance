import { describe, expect, it, vi } from 'vitest';

import { SupabasePasswordRecoveryGateway } from './supabase-password-recovery.gateway.js';

describe('SupabasePasswordRecoveryGateway', () => {
  it('requests a one-time recovery link with the configured redirect', async () => {
    const resetPasswordForEmail = vi.fn().mockResolvedValue({ error: null });
    const gateway = new SupabasePasswordRecoveryGateway(() => ({
      auth: { resetPasswordForEmail },
    }));

    await gateway.request({
      email: 'synthetic.user@example.test',
      redirectUrl: 'https://app.example.test/auth/reset-password',
    });

    expect(resetPasswordForEmail).toHaveBeenCalledWith(
      'synthetic.user@example.test',
      { redirectTo: 'https://app.example.test/auth/reset-password' },
    );
  });

  it('does not expose provider outcomes that could enumerate an address', async () => {
    const gateway = new SupabasePasswordRecoveryGateway(() => ({
      auth: {
        resetPasswordForEmail: vi
          .fn()
          .mockResolvedValue({ error: new Error('provider detail') }),
      },
    }));

    await expect(
      gateway.request({
        email: 'synthetic.user@example.test',
        redirectUrl: 'https://app.example.test/auth/reset-password',
      }),
    ).resolves.toBeUndefined();
  });
});
