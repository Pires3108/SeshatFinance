import {
  AuthenticateUserUseCase,
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
      .fn()
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
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AuthenticateUserUseCase)
      .useValue({ execute: authenticate })
      .overrideProvider(OpaqueSessionService)
      .useValue({ issue, resolve, revoke })
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
      'HttpOnly; Secure; SameSite=Lax',
    );
    const browserCookie = `__Host-seshat_session=${'a'.repeat(43)}`;

    const check = await application.inject({
      method: 'GET',
      url: '/api/v1/auth/sessions',
      headers: { cookie: browserCookie },
    });
    expect(check.statusCode).toBe(204);
    expect(resolve).toHaveBeenCalledWith('a'.repeat(43));

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
  });
});
