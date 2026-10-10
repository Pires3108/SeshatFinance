import {
  AuthenticateUserUseCase,
  ListOwnedAccountsUseCase,
  OpaqueSessionService,
} from '@seshat/application';
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { configureApplication } from '../src/platform/configure-application.js';

describe('API browser sessions', () => {
  let application: NestFastifyApplication | undefined;

  afterEach(async (): Promise<void> => {
    await application?.close();
    application = undefined;
  });

  it('creates, checks, and revokes an opaque cookie without returning provider credentials', async () => {
    const authenticate = vi
      .fn<AuthenticateUserUseCase['execute']>()
      .mockResolvedValue({ userId: '00000000-0000-4000-8000-000000000001' });
    const issue = vi
      .fn()
      .mockResolvedValue({ token: 'a'.repeat(43), expiresAt: new Date() });
    let revoked = false;
    const resolve = vi
      .fn()
      .mockImplementation(() =>
        revoked
          ? Promise.reject(new Error('revoked'))
          : Promise.resolve('00000000-0000-4000-8000-000000000001'),
      );
    const revoke = vi.fn().mockImplementation(() => {
      revoked = true;
      return Promise.resolve();
    });
    const revokeOtherSessions = vi.fn().mockResolvedValue(undefined);
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AuthenticateUserUseCase)
      .useValue({
        executeWith: async (
          credentials: Readonly<{ email: string; password: string }>,
          onAuthenticated: (
            identity: Readonly<{ userId: string }>,
          ) => Promise<unknown>,
        ) => onAuthenticated(await authenticate(credentials)),
      })
      .overrideProvider(OpaqueSessionService)
      .useValue({ issue, resolve, revoke, revokeOtherSessions })
      .overrideProvider(ListOwnedAccountsUseCase)
      .useValue({ execute: vi.fn().mockResolvedValue([]) })
      .compile();
    application = module.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    configureApplication(application);
    await application.init();
    await application.getHttpAdapter().getInstance().ready();

    const login = await application.inject({
      method: 'POST',
      url: '/api/v1/auth/sessions',
      payload: {
        email: 'synthetic@example.test',
        password: 'synthetic-password',
      },
    });
    expect(login.statusCode).toBe(204);
    expect(login.body).toBe('');
    expect(login.headers['set-cookie']).toContain(
      'HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=43200',
    );
    expect(login.headers['set-cookie']).toContain('__Host-seshat_session=');
    expect(login.body).not.toContain('synthetic');
    const browserCookie = `__Host-seshat_session=${'a'.repeat(43)}`;

    const check = await application.inject({
      method: 'GET',
      url: '/api/v1/auth/sessions',
      headers: { cookie: browserCookie },
    });
    expect(check.statusCode).toBe(204);
    expect(resolve).toHaveBeenCalledWith('a'.repeat(43));

    const protectedRead = await application.inject({
      method: 'GET',
      url: '/api/v1/accounts',
      headers: { cookie: browserCookie },
    });
    expect(protectedRead.statusCode).toBe(200);
    const protectedWrite = await application.inject({
      method: 'POST',
      url: '/api/v1/accounts',
      headers: { cookie: browserCookie },
      payload: {},
    });
    expect(protectedWrite.statusCode).toBe(400);

    const remoteClose = await application.inject({
      method: 'DELETE',
      url: '/api/v1/auth/sessions/others',
      headers: { cookie: browserCookie },
    });
    expect(remoteClose.statusCode).toBe(204);
    expect(revokeOtherSessions).toHaveBeenCalledWith('a'.repeat(43));
    const unauthenticatedRemoteClose = await application.inject({
      method: 'DELETE',
      url: '/api/v1/auth/sessions/others',
    });
    expect(unauthenticatedRemoteClose.statusCode).toBe(401);

    const logout = await application.inject({
      method: 'DELETE',
      url: '/api/v1/auth/sessions',
      headers: { cookie: browserCookie },
    });
    expect(logout.statusCode).toBe(204);
    expect(revoke).toHaveBeenCalledWith('a'.repeat(43));
    expect(logout.headers['set-cookie']).toContain('Max-Age=0');

    const afterLogout = await application.inject({
      method: 'GET',
      url: '/api/v1/auth/sessions',
      headers: { cookie: browserCookie },
    });
    expect(afterLogout.statusCode).toBe(401);
    for (const method of ['GET', 'POST'] as const) {
      const denied = await application.inject({
        method,
        url: '/api/v1/accounts',
        headers: { cookie: browserCookie },
        ...(method === 'POST' ? { payload: {} } : {}),
      });
      expect(denied.statusCode).toBe(401);
    }
  });

  it.each(['30 minute inactivity', '12 hour absolute lifetime'])(
    'rejects protected reads and writes after %s expiry',
    async (): Promise<void> => {
      const module = await Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(OpaqueSessionService)
        .useValue({
          resolve: vi.fn().mockRejectedValue(new Error('Session expired.')),
        })
        .compile();
      application = module.createNestApplication<NestFastifyApplication>(
        new FastifyAdapter(),
      );
      configureApplication(application);
      await application.init();
      await application.getHttpAdapter().getInstance().ready();
      const cookie = `__Host-seshat_session=${'a'.repeat(43)}`;
      for (const method of ['GET', 'POST'] as const) {
        const response = await application.inject({
          method,
          url: '/api/v1/accounts',
          headers: { cookie },
          ...(method === 'POST' ? { payload: {} } : {}),
        });
        expect(response.statusCode).toBe(401);
      }
    },
  );
});
