import {
  AuthenticateUserUseCase,
  type OpaqueSessionService,
  type IdentityAuthenticationGateway,
} from '@seshat/application';
import {
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { describe, expect, it, vi } from 'vitest';

import { SessionController, readSessionCookie } from './session.controller.js';

describe('SessionController', () => {
  const authentication = (
    gateway: IdentityAuthenticationGateway,
  ): AuthenticateUserUseCase =>
    new AuthenticateUserUseCase(
      gateway,
      {
        runExclusive: async (_email, action) =>
          action({
            isLocked: vi.fn().mockResolvedValue(false),
            recordFailure: vi.fn().mockResolvedValue(undefined),
            clear: vi.fn().mockResolvedValue(undefined),
          }),
      },
      { now: () => new Date('2026-10-09T12:00:00Z') },
    );

  it('issues only a secure HttpOnly cookie after valid credentials', async () => {
    const authenticate = authentication({
      authenticate: vi.fn().mockResolvedValue({ userId: 'user-id' }),
    });
    const issue = vi
      .fn()
      .mockResolvedValue({ token: 'a'.repeat(43), expiresAt: new Date() });
    const sessions = { issue } as unknown as OpaqueSessionService;
    const header = vi.fn();
    const controller = new SessionController(authenticate, sessions);

    await controller.login(
      { email: 'synthetic@example.test', password: 'synthetic-password' },
      { header } as unknown as FastifyReply,
    );

    expect(issue).toHaveBeenCalledWith('user-id');
    expect(header).toHaveBeenCalledWith(
      'Set-Cookie',
      expect.stringContaining(
        'HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=43200',
      ),
    );
  });

  it('does not issue a session for invalid credentials', async () => {
    const authenticate = authentication({
      authenticate: vi.fn().mockRejectedValue(new Error('provider detail')),
    });
    const issue = vi.fn();
    const sessions = { issue } as unknown as OpaqueSessionService;
    const controller = new SessionController(authenticate, sessions);

    await expect(
      controller.login({ email: 'synthetic@example.test', password: 'wrong' }, {
        header: vi.fn(),
      } as unknown as FastifyReply),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(issue).not.toHaveBeenCalled();
  });

  it('reports session storage failure without calling it invalid credentials', async () => {
    const authenticate = authentication({
      authenticate: vi.fn().mockResolvedValue({ userId: 'user-id' }),
    });
    const sessions = {
      issue: vi.fn().mockRejectedValue(new Error('private database detail')),
    } as unknown as OpaqueSessionService;
    const controller = new SessionController(authenticate, sessions);
    await expect(
      controller.login(
        { email: 'synthetic@example.test', password: 'synthetic-password' },
        { header: vi.fn() } as unknown as FastifyReply,
      ),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('revokes the session and clears the cookie', async () => {
    const revoke = vi.fn().mockResolvedValue(undefined);
    const sessions = { revoke } as unknown as OpaqueSessionService;
    const header = vi.fn();
    const controller = new SessionController(
      authentication({ authenticate: vi.fn() }),
      sessions,
    );
    await controller.logout(
      {
        headers: { cookie: `__Host-seshat_session=${'a'.repeat(43)}` },
      } as FastifyRequest,
      { header } as unknown as FastifyReply,
    );
    expect(revoke).toHaveBeenCalledWith('a'.repeat(43));
    expect(header).toHaveBeenCalledWith(
      'Set-Cookie',
      expect.stringContaining('Max-Age=0'),
    );
  });

  it('checks the active server session for browser refresh', async () => {
    const resolve = vi.fn().mockResolvedValue('user-id');
    const controller = new SessionController(
      authentication({ authenticate: vi.fn() }),
      { resolve } as unknown as OpaqueSessionService,
    );
    await controller.check({
      headers: { cookie: `__Host-seshat_session=${'a'.repeat(43)}` },
    } as FastifyRequest);
    expect(resolve).toHaveBeenCalledWith('a'.repeat(43));
  });

  it('clears an expired or absent cookie during logout', async () => {
    const revoke = vi.fn();
    const header = vi.fn();
    const controller = new SessionController(
      authentication({ authenticate: vi.fn() }),
      { revoke } as unknown as OpaqueSessionService,
    );
    await controller.logout(
      { headers: {} } as FastifyRequest,
      { header } as unknown as FastifyReply,
    );
    expect(revoke).not.toHaveBeenCalled();
    expect(header).toHaveBeenCalledWith(
      'Set-Cookie',
      expect.stringContaining('Max-Age=0'),
    );
  });

  it('rejects malformed cookies', () => {
    expect(readSessionCookie('__Host-seshat_session=short')).toBeUndefined();
  });
});
