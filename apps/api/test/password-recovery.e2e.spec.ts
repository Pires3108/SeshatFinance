import {
  CompletePasswordRecoveryUseCase,
  InvalidRecoveryTokenError,
  PasswordRejectedError,
  RequestPasswordRecoveryUseCase,
} from '@seshat/application';
import { Test } from '@nestjs/testing';
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { configureApplication } from '../src/platform/configure-application.js';

describe('API password recovery', () => {
  let application: NestFastifyApplication | undefined;
  const originalRedirectUrl = process.env.AUTH_PASSWORD_RECOVERY_REDIRECT_URL;

  afterEach(async (): Promise<void> => {
    await application?.close();
    application = undefined;
    if (originalRedirectUrl === undefined) {
      delete process.env.AUTH_PASSWORD_RECOVERY_REDIRECT_URL;
    } else {
      process.env.AUTH_PASSWORD_RECOVERY_REDIRECT_URL = originalRedirectUrl;
    }
  });

  it('returns only the generic accepted response', async () => {
    process.env.AUTH_PASSWORD_RECOVERY_REDIRECT_URL =
      'https://app.example.test/auth/reset-password';
    const execute = vi.fn<RequestPasswordRecoveryUseCase['execute']>();
    const testingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(RequestPasswordRecoveryUseCase)
      .useValue({ execute })
      .compile();
    application = testingModule.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    configureApplication(application);
    await application.init();
    await application.getHttpAdapter().getInstance().ready();

    const response = await application.inject({
      method: 'POST',
      payload: { email: 'synthetic.user@example.test' },
      url: '/api/v1/auth/password-recovery-requests',
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({ status: 'accepted' });
    expect(response.body).not.toContain('synthetic.user');
    expect(execute).toHaveBeenCalledWith({
      email: 'synthetic.user@example.test',
      redirectUrl: 'https://app.example.test/auth/reset-password',
    });
  });

  it('rejects malformed email input before the use case', async () => {
    const execute = vi.fn<RequestPasswordRecoveryUseCase['execute']>();
    const testingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(RequestPasswordRecoveryUseCase)
      .useValue({ execute })
      .compile();
    application = testingModule.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    configureApplication(application);
    await application.init();
    await application.getHttpAdapter().getInstance().ready();

    const response = await application.inject({
      method: 'POST',
      payload: { email: 'invalid' },
      url: '/api/v1/auth/password-recovery-requests',
    });

    expect(response.statusCode).toBe(400);
    expect(execute).not.toHaveBeenCalled();
  });

  it('completes recovery without returning identity or token data', async () => {
    const execute = vi.fn<CompletePasswordRecoveryUseCase['execute']>();
    const testingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(CompletePasswordRecoveryUseCase)
      .useValue({ execute })
      .compile();
    application = testingModule.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    configureApplication(application);
    await application.init();
    await application.getHttpAdapter().getInstance().ready();

    const response = await application.inject({
      method: 'POST',
      payload: { tokenHash: 'one-use-proof', password: 'new-password' },
      url: '/api/v1/auth/password-recovery-completions',
    });
    expect(response.statusCode).toBe(204);
    expect(response.body).toBe('');
    expect(execute).toHaveBeenCalledWith('one-use-proof', 'new-password');
  });

  it('returns a generic rejection for an invalid or replayed proof', async () => {
    const execute = vi
      .fn<CompletePasswordRecoveryUseCase['execute']>()
      .mockRejectedValue(new InvalidRecoveryTokenError());
    const testingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(CompletePasswordRecoveryUseCase)
      .useValue({ execute })
      .compile();
    application = testingModule.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    configureApplication(application);
    await application.init();
    await application.getHttpAdapter().getInstance().ready();

    const response = await application.inject({
      method: 'POST',
      payload: { tokenHash: 'replayed', password: 'new-password' },
      url: '/api/v1/auth/password-recovery-completions',
    });
    expect(response.statusCode).toBe(400);
    expect(response.body).not.toContain('replayed');
    expect(response.body).not.toContain('new-password');
  });

  it('rejects malformed completion input before consuming a proof', async () => {
    const execute = vi.fn<CompletePasswordRecoveryUseCase['execute']>();
    const testingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(CompletePasswordRecoveryUseCase)
      .useValue({ execute })
      .compile();
    application = testingModule.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    configureApplication(application);
    await application.init();
    await application.getHttpAdapter().getInstance().ready();

    const response = await application.inject({
      method: 'POST',
      payload: { tokenHash: '', password: 'new-password' },
      url: '/api/v1/auth/password-recovery-completions',
    });
    expect(response.statusCode).toBe(400);
    expect(execute).not.toHaveBeenCalled();
  });

  it('returns no internal detail when completion cannot revoke sessions', async () => {
    const execute = vi
      .fn<CompletePasswordRecoveryUseCase['execute']>()
      .mockRejectedValue(new Error('private database detail'));
    const testingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(CompletePasswordRecoveryUseCase)
      .useValue({ execute })
      .compile();
    application = testingModule.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    configureApplication(application);
    await application.init();
    await application.getHttpAdapter().getInstance().ready();

    const response = await application.inject({
      method: 'POST',
      payload: { tokenHash: 'proof', password: 'new-password' },
      url: '/api/v1/auth/password-recovery-completions',
    });
    expect(response.statusCode).toBe(503);
    expect(response.body).not.toContain('private database detail');
    expect(response.body).not.toContain('proof');
    expect(response.body).not.toContain('new-password');
  });

  it('uses a generic password category when the provider rejects strength or breach', async () => {
    const execute = vi
      .fn<CompletePasswordRecoveryUseCase['execute']>()
      .mockRejectedValue(new PasswordRejectedError());
    const testingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(CompletePasswordRecoveryUseCase)
      .useValue({ execute })
      .compile();
    application = testingModule.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    configureApplication(application);
    await application.init();
    await application.getHttpAdapter().getInstance().ready();
    const response = await application.inject({
      method: 'POST',
      payload: {
        tokenHash: 'proof',
        password: 'synthetic-password-only-for-tests',
      },
      url: '/api/v1/auth/password-recovery-completions',
    });
    expect(response.statusCode).toBe(422);
    expect(response.body).toContain('"code":"PASSWORD_REJECTED"');
    expect(response.body).not.toContain('synthetic-password');
    expect(response.body).not.toContain('proof');
  });
});
