import { describe, expect, it, vi } from 'vitest';

import type { AuthenticationAttemptRepository } from './rate-limited-identity-authentication.js';
import {
  IdentityProviderUnavailableError,
  InvalidIdentityCredentialsError,
  RateLimitedIdentityAuthenticationGateway,
} from './rate-limited-identity-authentication.js';

describe('RateLimitedIdentityAuthenticationGateway', () => {
  it('uses normalized identity and a supplied clock for shared limit state', async () => {
    const now = new Date('2026-10-03T12:00:00.000Z');
    const execute = vi.fn<AuthenticationAttemptRepository['execute']>(
      async (_email, _now, authenticate) => authenticate(),
    );
    const authenticate = vi
      .fn()
      .mockResolvedValue({ userId: 'synthetic-user' });
    const gateway = new RateLimitedIdentityAuthenticationGateway(
      { authenticate },
      { execute },
      { now: () => now },
    );

    expect(
      await gateway.authenticate({
        email: '  SYNTHETIC.USER@EXAMPLE.TEST  ',
        password: 'synthetic-password',
      }),
    ).toEqual({ userId: 'synthetic-user' });
    expect(execute).toHaveBeenCalledWith(
      'synthetic.user@example.test',
      now,
      expect.any(Function),
    );
    expect(authenticate).toHaveBeenCalledWith({
      email: '  SYNTHETIC.USER@EXAMPLE.TEST  ',
      password: 'synthetic-password',
    });
  });

  it('does not call the provider for a blocked identity', async () => {
    const authenticate = vi.fn();
    const gateway = new RateLimitedIdentityAuthenticationGateway(
      { authenticate },
      { execute: () => Promise.resolve({ kind: 'blocked' }) },
      { now: () => new Date('2026-10-03T12:00:00.000Z') },
    );
    await expect(
      gateway.authenticate({
        email: 'synthetic.user@example.test',
        password: 'synthetic-password',
      }),
    ).rejects.toBeInstanceOf(InvalidIdentityCredentialsError);
    expect(authenticate).not.toHaveBeenCalled();
  });

  it('distinguishes provider outages from invalid credentials internally', async () => {
    const gateway = new RateLimitedIdentityAuthenticationGateway(
      {
        authenticate: () => Promise.reject(new Error('provider detail')),
      },
      {
        execute: (_email, _now, authenticate) => authenticate(),
      },
      { now: () => new Date('2026-10-03T12:00:00.000Z') },
    );
    await expect(
      gateway.authenticate({
        email: 'synthetic.user@example.test',
        password: 'synthetic-password',
      }),
    ).rejects.toBeInstanceOf(IdentityProviderUnavailableError);
  });
});
