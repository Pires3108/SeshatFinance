import { Test } from '@nestjs/testing';
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { configureApplication } from '../src/platform/configure-application.js';

describe('API health', () => {
  let application: NestFastifyApplication | undefined;

  afterEach(async (): Promise<void> => {
    await application?.close();
  });

  it('reports the service as healthy', async (): Promise<void> => {
    const testingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    application = testingModule.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    configureApplication(application);
    await application.init();
    await application.getHttpAdapter().getInstance().ready();

    const response = await application.inject({
      method: 'GET',
      url: '/api/v1/health',
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['x-correlation-id']).toMatch(/^[0-9a-f-]{36}$/u);
    expect(response.json()).toEqual({ service: 'api', status: 'ok' });
  });

  it('preserves a valid caller correlation identifier', async (): Promise<void> => {
    const testingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    application = testingModule.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    configureApplication(application);
    await application.init();
    await application.getHttpAdapter().getInstance().ready();

    const response = await application.inject({
      headers: { 'x-correlation-id': 'integration-test-01' },
      method: 'GET',
      url: '/api/v1/health',
    });

    expect(response.headers['x-correlation-id']).toBe('integration-test-01');
  });
});
