import { Controller, Get } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { configureApplication } from '../src/platform/configure-application.js';

@Controller('test-errors')
class TestErrorController {
  @Get()
  public throwUnexpectedError(): never {
    throw new Error('sensitive internal detail');
  }
}

describe('API error envelope', () => {
  let application: NestFastifyApplication | undefined;

  afterEach(async (): Promise<void> => {
    await application?.close();
  });

  it('returns a safe error with the request correlation identifier', async (): Promise<void> => {
    const testingModule = await Test.createTestingModule({
      controllers: [TestErrorController],
      imports: [AppModule],
    }).compile();
    application = testingModule.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    configureApplication(application);
    await application.init();
    await application.getHttpAdapter().getInstance().ready();

    const response = await application.inject({
      headers: { 'x-correlation-id': 'safe-error-test' },
      method: 'GET',
      url: '/api/v1/test-errors',
    });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({
      error: {
        code: 'INTERNAL_ERROR',
        correlationId: 'safe-error-test',
        message: 'Não foi possível concluir a solicitação.',
      },
    });
    expect(response.body).not.toContain('sensitive internal detail');
  });
});
