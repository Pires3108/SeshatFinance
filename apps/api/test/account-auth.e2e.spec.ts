import 'reflect-metadata';

import { Test } from '@nestjs/testing';
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { configureApplication } from '../src/platform/configure-application.js';

describe('Financial API authorization', () => {
  let application: NestFastifyApplication;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    application = module.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
      { logger: false },
    );
    configureApplication(application);
    await application.init();
    await application.getHttpAdapter().getInstance().ready();
  });

  afterEach(async () => {
    await application.close();
  });

  it('rejects account writes without a verified bearer actor', async () => {
    const response = await application.inject({
      method: 'POST',
      payload: {},
      url: '/api/v1/accounts',
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({
      error: { code: 'UNAUTHENTICATED' },
    });
  });

  it.each([
    [
      'POST',
      '/api/v1/accounts/7c2c7a54-73fe-49a3-b0ea-19034bf22baf/balance-adjustments',
    ],
    [
      'POST',
      '/api/v1/accounts/7c2c7a54-73fe-49a3-b0ea-19034bf22baf/transactions',
    ],
    ['POST', '/api/v1/credit-cards'],
    ['POST', '/api/v1/categories'],
    ['POST', '/api/v1/cost-centers'],
    ['POST', '/api/v1/tags'],
    ['POST', '/api/v1/transfers'],
    ['PATCH', '/api/v1/accounts/7c2c7a54-73fe-49a3-b0ea-19034bf22baf'],
    [
      'PATCH',
      '/api/v1/accounts/7c2c7a54-73fe-49a3-b0ea-19034bf22baf/lifecycle',
    ],
    ['PATCH', '/api/v1/transactions/c722103a-e28a-482c-b6e9-e3320d8a44e3'],
    [
      'PATCH',
      '/api/v1/transactions/c722103a-e28a-482c-b6e9-e3320d8a44e3/lifecycle',
    ],
    [
      'PATCH',
      '/api/v1/transfers/c722103a-e28a-482c-b6e9-e3320d8a44e3/lifecycle',
    ],
    [
      'PUT',
      '/api/v1/transactions/c722103a-e28a-482c-b6e9-e3320d8a44e3/classification',
    ],
    ['PUT', '/api/v1/transactions/c722103a-e28a-482c-b6e9-e3320d8a44e3/tags'],
  ])('rejects anonymous %s %s before financial writes', async (method, url) => {
    const response = await application.inject({
      method: method as 'POST' | 'PATCH' | 'PUT',
      payload: {},
      url,
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({
      error: { code: 'UNAUTHENTICATED' },
    });
  });

  it.each([
    ['GET', '/api/v1/accounts'],
    ['GET', '/api/v1/account-types'],
    ['GET', '/api/v1/accounts/7c2c7a54-73fe-49a3-b0ea-19034bf22baf'],
    ['GET', '/api/v1/accounts/7c2c7a54-73fe-49a3-b0ea-19034bf22baf/balance'],
    [
      'GET',
      '/api/v1/accounts/7c2c7a54-73fe-49a3-b0ea-19034bf22baf/balance-adjustments',
    ],
    [
      'GET',
      '/api/v1/accounts/7c2c7a54-73fe-49a3-b0ea-19034bf22baf/transactions',
    ],
    ['GET', '/api/v1/transactions'],
    ['GET', '/api/v1/transactions/c722103a-e28a-482c-b6e9-e3320d8a44e3'],
    ['GET', '/api/v1/credit-cards'],
    ['GET', '/api/v1/transfers'],
    ['GET', '/api/v1/transfers/c722103a-e28a-482c-b6e9-e3320d8a44e3'],
    ['GET', '/api/v1/credit-cards/c722103a-e28a-482c-b6e9-e3320d8a44e3'],
    ['GET', '/api/v1/investment-types'],
  ])('rejects anonymous %s %s before financial reads', async (method, url) => {
    const response = await application.inject({ method: method as 'GET', url });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({
      error: { code: 'UNAUTHENTICATED' },
    });
  });
});
