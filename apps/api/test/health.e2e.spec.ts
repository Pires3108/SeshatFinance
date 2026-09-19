import { Test } from '@nestjs/testing';
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module.js';

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
    application.setGlobalPrefix('api/v1');
    await application.init();
    await application.getHttpAdapter().getInstance().ready();

    const response = await application.inject({
      method: 'GET',
      url: '/api/v1/health',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ service: 'api', status: 'ok' });
  });
});
