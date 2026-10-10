import { describe, expect, it, vi } from 'vitest';

import { SupabaseRegistrationConfirmationResendGateway } from './supabase-registration-confirmation-resend.gateway.js';

describe('Supabase registration confirmation resend', () => {
  it('sends a signup message to the configured callback and accepts unknown addresses generically', async () => {
    const resend = vi
      .fn()
      .mockResolvedValueOnce({ error: null })
      .mockResolvedValueOnce({ error: { code: 'user_not_found' } });
    const gateway = new SupabaseRegistrationConfirmationResendGateway(() => ({
      auth: { resend },
    }));
    const command = {
      email: 'synthetic@example.test',
      confirmationRedirectUrl: 'https://example.test/confirm',
    };
    await expect(gateway.resend(command)).resolves.toBeUndefined();
    await expect(gateway.resend(command)).resolves.toBeUndefined();
    expect(resend).toHaveBeenCalledWith({
      type: 'signup',
      email: command.email,
      options: { emailRedirectTo: command.confirmationRedirectUrl },
    });
  });
});
