import 'reflect-metadata';

import { readFile } from 'node:fs/promises';

import {
  AuthenticateUserUseCase,
  InvalidIdentityCredentialsError,
  OpaqueSessionService,
  RateLimitedIdentityAuthenticationGateway,
} from '@seshat/application';
import {
  createPrismaClient,
  PrismaAuthenticationAttemptRepository,
} from '@seshat/database';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { configureApplication } from '../src/platform/configure-application.js';

const email = 'synthetic.user@example.test';
const unknownEmail = 'unknown.user@example.test';
const hmacKey = 'synthetic-authentication-limit-key-only-for-tests';

describe('shared HTTP authentication limit', () => {
  let first: NestFastifyApplication | undefined;
  let second: NestFastifyApplication | undefined;
  let firstClient: ReturnType<typeof createPrismaClient> | undefined;
  let secondClient: ReturnType<typeof createPrismaClient> | undefined;
  let stop: (() => Promise<void>) | undefined;
  let now = new Date('2026-10-03T12:00:00.000Z');
  const authenticate = vi.fn(
    (command: {
      email: string;
      password: string;
    }): Promise<{ userId: string }> => {
      if (command.email === email && command.password === 'correct-password')
        return Promise.resolve({
          userId: '00000000-0000-4000-8000-000000000001',
        });
      return Promise.reject(new InvalidIdentityCredentialsError());
    },
  );
  const issue = vi.fn(() =>
    Promise.resolve({
      token: 'a'.repeat(43),
      expiresAt: new Date('2026-10-04T00:00:00.000Z'),
    }),
  );

  beforeAll(async (): Promise<void> => {
    const container = await new PostgreSqlContainer('postgres:17-alpine')
      .withDatabase('seshat_test')
      .withUsername('seshat_test')
      .withPassword('synthetic-test-password')
      .start();
    stop = async (): Promise<void> => container.stop().then(() => undefined);
    firstClient = createPrismaClient(container.getConnectionUri());
    secondClient = createPrismaClient(container.getConnectionUri());
    const migration = await readFile(
      new URL(
        '../../../packages/database/prisma/migrations/20261003220000_create_authentication_attempt_limits/migration.sql',
        import.meta.url,
      ),
      'utf8',
    );
    await firstClient.$executeRawUnsafe(migration);
    first = await createApplication(firstClient);
    second = await createApplication(secondClient);
  }, 60_000);

  afterAll(async (): Promise<void> => {
    await first?.close();
    await second?.close();
    await firstClient?.$disconnect();
    await secondClient?.$disconnect();
    await stop?.();
  });

  async function createApplication(
    client: ReturnType<typeof createPrismaClient>,
  ): Promise<NestFastifyApplication> {
    const attempts = new PrismaAuthenticationAttemptRepository(client, hmacKey);
    const identities = new RateLimitedIdentityAuthenticationGateway(
      { authenticate },
      attempts,
      { now: (): Date => now },
    );
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AuthenticateUserUseCase)
      .useValue(new AuthenticateUserUseCase(identities))
      .overrideProvider(OpaqueSessionService)
      .useValue({ issue, resolve: vi.fn(), revoke: vi.fn() })
      .compile();
    const application = module.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
      { logger: false },
    );
    configureApplication(application);
    await application.init();
    await application.getHttpAdapter().getInstance().ready();
    return application;
  }

  async function login(
    application: NestFastifyApplication,
    address: string,
    password: string,
    ip: string,
  ): Promise<Awaited<ReturnType<NestFastifyApplication['inject']>>> {
    return application.inject({
      method: 'POST',
      url: '/api/v1/auth/sessions',
      headers: { 'x-forwarded-for': ip },
      payload: { email: address, password },
    });
  }

  it('blocks the sixth request across API instances and IPs without account enumeration', async () => {
    if (first === undefined || second === undefined)
      throw new Error('Applications unavailable.');
    for (const address of [email, unknownEmail]) {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const response = await login(
          attempt % 2 === 0 ? first : second,
          address.toUpperCase(),
          'wrong-password',
          `192.0.2.${String(attempt + 1)}`,
        );
        expect(response.statusCode).toBe(401);
        expect(response.headers['set-cookie']).toBeUndefined();
      }
    }
    const knownBlocked = await login(
      second,
      email,
      'correct-password',
      '192.0.2.50',
    );
    const unknownBlocked = await login(
      first,
      unknownEmail,
      'correct-password',
      '192.0.2.51',
    );
    expect(knownBlocked.statusCode).toBe(401);
    expect(unknownBlocked.statusCode).toBe(knownBlocked.statusCode);
    const withoutCorrelationId = (body: string): string =>
      body.replace(/"correlationId":"[^"]+"/gu, '"correlationId":"<request>"');
    expect(withoutCorrelationId(unknownBlocked.body)).toBe(
      withoutCorrelationId(knownBlocked.body),
    );
    expect(knownBlocked.headers['set-cookie']).toBeUndefined();
    expect(unknownBlocked.headers['set-cookie']).toBeUndefined();
    expect(issue).not.toHaveBeenCalled();
    expect(authenticate).toHaveBeenCalledTimes(10);

    now = new Date(now.getTime() + 5 * 60_000);
    const recovered = await login(
      first,
      email,
      'correct-password',
      '192.0.2.52',
    );
    expect(recovered.statusCode).toBe(204);
    expect(issue).toHaveBeenCalledOnce();
  });
});
