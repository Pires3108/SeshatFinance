import { describe, expect, it, vi } from 'vitest';

import {
  ConfirmRegistrationUseCase,
  type ConfirmedIdentityProfileRepository,
  type RegistrationConfirmationGateway,
} from './confirm-registration.js';

describe('ConfirmRegistrationUseCase', () => {
  it('links only a provider-confirmed identity using the injected clock', async () => {
    const identity = {
      id: 'synthetic-identity',
      email: 'synthetic@example.test',
      displayName: 'Pessoa fictícia',
    };
    const confirm = vi
      .fn<RegistrationConfirmationGateway['confirm']>()
      .mockResolvedValue(identity);
    const ensure = vi
      .fn<ConfirmedIdentityProfileRepository['ensure']>()
      .mockResolvedValue(undefined);
    const instant = new Date('2026-10-06T12:00:00Z');
    const useCase = new ConfirmRegistrationUseCase(
      { confirm },
      { ready: vi.fn(), ensure },
      { now: (): Date => new Date(instant) },
    );
    await expect(useCase.execute('synthetic-token')).resolves.toBe(true);
    expect(ensure).toHaveBeenCalledWith(identity, instant);
  });

  it('does not create a local profile for invalid, expired or consumed tokens', async () => {
    const confirm = vi
      .fn<RegistrationConfirmationGateway['confirm']>()
      .mockResolvedValue(null);
    const ensure = vi.fn<ConfirmedIdentityProfileRepository['ensure']>();
    const useCase = new ConfirmRegistrationUseCase(
      { confirm },
      { ready: vi.fn(), ensure },
      { now: (): Date => new Date('2026-10-06T12:00:00Z') },
    );
    await expect(useCase.execute('synthetic-invalid-token')).resolves.toBe(
      false,
    );
    expect(ensure).not.toHaveBeenCalled();
  });

  it('does not create an orphan local profile after provider failure', async () => {
    const confirm = vi
      .fn<RegistrationConfirmationGateway['confirm']>()
      .mockRejectedValue(new Error('Synthetic provider unavailable.'));
    const ensure = vi.fn<ConfirmedIdentityProfileRepository['ensure']>();
    const useCase = new ConfirmRegistrationUseCase(
      { confirm },
      { ready: vi.fn(), ensure },
      { now: (): Date => new Date('2026-10-06T12:00:00Z') },
    );
    await expect(useCase.execute('synthetic-token')).rejects.toThrow(
      'Synthetic provider unavailable.',
    );
    expect(ensure).not.toHaveBeenCalled();
  });

  it('does not consume the provider token while local persistence is unavailable', async () => {
    const confirm = vi.fn<RegistrationConfirmationGateway['confirm']>();
    const useCase = new ConfirmRegistrationUseCase(
      { confirm },
      {
        ready: vi.fn().mockRejectedValue(new Error('database unavailable')),
        ensure: vi.fn(),
      },
      { now: (): Date => new Date('2026-10-09T12:00:00Z') },
    );
    await expect(useCase.execute('synthetic-token')).rejects.toThrow(
      'database unavailable',
    );
    expect(confirm).not.toHaveBeenCalled();
  });

  it('surfaces a post-OTP database failure for provider-authenticated reconciliation', async () => {
    const identity = {
      id: '11111111-1111-4111-8111-111111111111',
      email: 'synthetic@example.test',
      displayName: 'Pessoa',
    };
    const ensure = vi.fn().mockRejectedValue(new Error('database unavailable'));
    const useCase = new ConfirmRegistrationUseCase(
      { confirm: vi.fn().mockResolvedValue(identity) },
      { ready: vi.fn(), ensure },
      { now: (): Date => new Date('2026-10-09T12:00:00Z') },
    );
    await expect(useCase.execute('synthetic-token')).rejects.toThrow(
      'database unavailable',
    );
    expect(ensure).toHaveBeenCalledWith(
      identity,
      new Date('2026-10-09T12:00:00Z'),
    );
  });
});
