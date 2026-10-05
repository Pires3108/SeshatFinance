import { CompletePasswordRecoveryUseCase } from '@seshat/application';
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { configureApplication } from '../src/platform/configure-application.js';

describe('API password recovery completion', () => {
  let application: NestFastifyApplication | undefined;

  afterEach(async (): Promise<void> => {
    await application?.close();
    application = undefined;
  });

  it('changes the password once and rejects a replay without leaking the token', async () => {
    const used = new Set<string>();
    const execute = vi.fn<CompletePasswordRecoveryUseCase['execute']>(
      (command) => {
        if (used.has(command.tokenHash)) return Promise.resolve(false);
        used.add(command.tokenHash);
        return Promise.resolve(true);
      },
    );
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(CompletePasswordRecoveryUseCase)
      .useValue({ execute })
      .compile();
    application = module.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    configureApplication(application);
    await application.init();
    await application.getHttpAdapter().getInstance().ready();

    const payload = {
      tokenHash: 'synthetic-recovery-token',
      password: 'new-synthetic-password',
    };
    const first = await application.inject({
      method: 'POST',
      url: '/api/v1/auth/password-recovery-completions',
      payload,
    });
    expect(first.statusCode).toBe(204);
    expect(first.body).toBe('');

    const replay = await application.inject({
      method: 'POST',
      url: '/api/v1/auth/password-recovery-completions',
      payload,
    });
    expect(replay.statusCode).toBe(400);
    expect(replay.body).not.toContain(payload.tokenHash);
    expect(replay.body).not.toContain(payload.password);
    expect(execute).toHaveBeenCalledTimes(2);
  }, 20_000);

  it('returns a retryable response when recovery provider is unavailable', async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(CompletePasswordRecoveryUseCase)
      .useValue({
        execute: (): Promise<boolean> =>
          Promise.reject(new Error('private provider detail')),
      })
      .compile();
    application = module.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    configureApplication(application);
    await application.init();
    await application.getHttpAdapter().getInstance().ready();

    const response = await application.inject({
      method: 'POST',
      url: '/api/v1/auth/password-recovery-completions',
      payload: {
        tokenHash: 'synthetic-recovery-token',
        password: 'new-synthetic-password',
      },
    });

    expect(response.statusCode).toBe(503);
    expect(response.body).not.toContain('private provider detail');
    expect(response.body).not.toContain('synthetic-recovery-token');
  }, 20_000);
});
