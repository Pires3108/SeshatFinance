import { describe, expect, it, vi } from 'vitest';

import {
  RequestPasswordRecoveryUseCase,
  type PasswordRecoveryGateway,
} from './request-password-recovery.js';

describe('RequestPasswordRecoveryUseCase', () => {
  it('delegates the recovery request without inspecting identity state', async () => {
    const request = vi.fn<PasswordRecoveryGateway['request']>();
    const command = {
      email: 'synthetic.user@example.test',
      redirectUrl: 'https://app.example.test/auth/reset-password',
    };

    await new RequestPasswordRecoveryUseCase({ request }).execute(command);

    expect(request).toHaveBeenCalledWith(command);
  });
});
