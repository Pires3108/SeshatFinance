import { describe, expect, it, vi } from 'vitest';

import {
  AuthenticateUserUseCase,
  type IdentityAuthenticationGateway,
  type IdentitySession,
} from './authenticate-user.js';

describe('AuthenticateUserUseCase', () => {
  it('delegates credentials to the identity boundary', async () => {
    const session: IdentitySession = {
      userId: '00000000-0000-4000-8000-000000000001',
    };
    const authenticate = vi
      .fn<IdentityAuthenticationGateway['authenticate']>()
      .mockResolvedValue(session);

    const result = await new AuthenticateUserUseCase({ authenticate }).execute({
      email: 'synthetic.user@example.test',
      password: 'synthetic-password-only-for-tests',
    });

    expect(result).toBe(session);
    expect(authenticate).toHaveBeenCalledOnce();
  });
});
