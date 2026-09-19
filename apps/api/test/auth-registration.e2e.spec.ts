import { RegisterUserUseCase } from '@seshat/application';
import { Test } from '@nestjs/testing';
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { configureApplication } from '../src/platform/configure-application.js';

describe('API auth registration', () => {
  let application: NestFastifyApplication | undefined;
  const originalRedirectUrl = process.env.AUTH_CONFIRMATION_REDIRECT_URL;

  afterEach(async (): Promise<void> => {
    await application?.close();
    application = undefined;
    if (originalRedirectUrl === undefined) {
      delete process.env.AUTH_CONFIRMATION_REDIRECT_URL;
    } else {
      process.env.AUTH_CONFIRMATION_REDIRECT_URL = originalRedirectUrl;
    }
  });

  it('accepts a valid registration without returning sensitive input', async () => {
    process.env.AUTH_CONFIRMATION_REDIRECT_URL =
      'https://app.example.test/auth/confirm';
    process.env.SUPABASE_PUBLISHABLE_KEY = 'synthetic-publishable-key';
    process.env.SUPABASE_URL = 'https://synthetic-project.supabase.co';
    const execute = vi.fn<RegisterUserUseCase['execute']>();
    const testingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(RegisterUserUseCase)
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
        displayName: 'Pessoa Teste',
        email: 'synthetic.user@example.test',
        password: 'synthetic-password-only-for-tests',
      },
      url: '/api/v1/auth/registrations',
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({ status: 'confirmation_required' });
    expect(response.body).not.toContain('synthetic-password');
    expect(execute).toHaveBeenCalledOnce();
  });

  it('rejects malformed registration input before the use case', async () => {
    const execute = vi.fn<RegisterUserUseCase['execute']>();
    const testingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(RegisterUserUseCase)
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
      payload: { displayName: '', email: 'invalid', password: '' },
      url: '/api/v1/auth/registrations',
    });

    expect(response.statusCode).toBe(400);
    expect(execute).not.toHaveBeenCalled();
  });
});
