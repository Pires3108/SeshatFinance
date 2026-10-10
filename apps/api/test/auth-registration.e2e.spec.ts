import {
  ConfirmRegistrationUseCase,
  RegisterUserUseCase,
  PasswordRejectedError,
  ResendRegistrationConfirmationUseCase,
} from '@seshat/application';
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

  it('does not leak provider details when a password fails the provider policy', async () => {
    process.env.AUTH_CONFIRMATION_REDIRECT_URL =
      'https://app.example.test/auth/confirm';
    process.env.SUPABASE_PUBLISHABLE_KEY = 'synthetic-publishable-key';
    process.env.SUPABASE_URL = 'https://synthetic-project.supabase.co';
    const execute = vi
      .fn<RegisterUserUseCase['execute']>()
      .mockRejectedValue(new PasswordRejectedError());
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
    expect(response.statusCode).toBe(422);
    expect(response.body).toContain('"code":"PASSWORD_REJECTED"');
    expect(response.body).not.toContain('synthetic-password');
    expect(response.body).not.toContain('synthetic.user');
  });

  it('accepts a valid single-use confirmation without returning provider credentials', async () => {
    const execute = vi
      .fn<ConfirmRegistrationUseCase['execute']>()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    const testingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(ConfirmRegistrationUseCase)
      .useValue({ execute })
      .compile();
    application = testingModule.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    configureApplication(application);
    await application.init();
    await application.getHttpAdapter().getInstance().ready();

    const first = await application.inject({
      method: 'POST',
      payload: { tokenHash: 'synthetic-token' },
      url: '/api/v1/auth/registrations/confirm',
    });
    const reused = await application.inject({
      method: 'POST',
      payload: { tokenHash: 'synthetic-token' },
      url: '/api/v1/auth/registrations/confirm',
    });

    expect(first.statusCode).toBe(204);
    expect(first.body).toBe('');
    expect(reused.statusCode).toBe(400);
    expect(reused.body).not.toContain('synthetic-token');
  });

  it('returns a generic response for a resend request', async () => {
    process.env.AUTH_CONFIRMATION_REDIRECT_URL =
      'https://app.example.test/auth/confirm';
    process.env.SUPABASE_PUBLISHABLE_KEY = 'synthetic-publishable-key';
    process.env.SUPABASE_URL = 'https://synthetic-project.supabase.co';
    const execute = vi.fn<ResendRegistrationConfirmationUseCase['execute']>();
    const testingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(ResendRegistrationConfirmationUseCase)
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
      payload: { email: 'synthetic@example.test' },
      url: '/api/v1/auth/registrations/resend',
    });
    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({ status: 'confirmation_required' });
    expect(execute).toHaveBeenCalledWith({
      email: 'synthetic@example.test',
      confirmationRedirectUrl: 'https://app.example.test/auth/confirm',
    });
  });
});
