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

    const allowAndRecord = vi.fn().mockResolvedValue(true);
    await new RequestPasswordRecoveryUseCase(
      { request },
      { allowAndRecord },
      { now: () => new Date('2026-10-10T12:00:00Z') },
    ).execute(command);

    expect(request).toHaveBeenCalledWith(command);
    expect(allowAndRecord).toHaveBeenCalledWith(
      command.email,
      new Date('2026-10-10T12:00:00Z'),
    );
  });

  it('normalizes identity and preserves the generic result when throttled', async () => {
    const request = vi.fn<PasswordRecoveryGateway['request']>();
    const allowAndRecord = vi.fn().mockResolvedValue(false);
    await new RequestPasswordRecoveryUseCase(
      { request },
      { allowAndRecord },
      { now: () => new Date('2026-10-10T12:00:00Z') },
    ).execute({
      email: '  SYNTHETIC.USER@example.test  ',
      redirectUrl: 'https://app.example.test/auth/reset-password',
    });
    expect(allowAndRecord).toHaveBeenCalledWith(
      'synthetic.user@example.test',
      expect.any(Date),
    );
    expect(request).not.toHaveBeenCalled();
  });
});
