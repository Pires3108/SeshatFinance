import { RequestPasswordRecoveryUseCase } from '@seshat/application';
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
});
