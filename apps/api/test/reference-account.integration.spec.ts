import 'reflect-metadata';

import { readFile } from 'node:fs/promises';

import { ResolveAuthenticatedActorUseCase } from '@seshat/application';
import {
  startPostgresTestDatabase,
  type PostgresTestDatabase,
} from '@seshat/test-support';
import { Test } from '@nestjs/testing';
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { configureApplication } from '../src/platform/configure-application.js';

const actorId = 'b36bfe2a-f319-49a8-aade-2a536ea3af38';
const accessToken = 'synthetic-reference-access-token';

describe('Reference account use case across HTTP and PostgreSQL', () => {
  let application: NestFastifyApplication | undefined;
  let database: PostgresTestDatabase | undefined;
  let sql: Client | undefined;
  const originalDatabaseUrl = process.env.DATABASE_URL;

  beforeAll(async (): Promise<void> => {
    database = await startPostgresTestDatabase();
    process.env.DATABASE_URL = database.connectionString;
    sql = new Client({ connectionString: database.connectionString });
    await sql.connect();

    for (const migration of [
      '20260920040000_create_accounts',
      '20260921210000_create_financial_audit_events',
    ]) {
      const source = await readFile(
        new URL(
          `../../../packages/database/prisma/migrations/${migration}/migration.sql`,
          import.meta.url,
        ),
        'utf8',
      );
      await sql.query(source);
    }

    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ResolveAuthenticatedActorUseCase)
      .useValue({
        execute: (token: string): Promise<{ id: string }> => {
          if (token !== accessToken) {
            return Promise.reject(new Error('Invalid test token.'));
          }
          return Promise.resolve({ id: actorId });
        },
      })
      .compile();
    application = module.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
      { logger: false },
    );
    configureApplication(application);
    await application.init();
    await application.getHttpAdapter().getInstance().ready();
  }, 60_000);

  afterAll(async (): Promise<void> => {
    await application?.close();
    await sql?.end();
    await database?.stop();
    if (originalDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = originalDatabaseUrl;
    }
  });

  it('creates an authorized account and its audit event', async (): Promise<void> => {
    if (application === undefined || sql === undefined) {
      throw new Error('Reference application was not initialized.');
    }

    const response = await application.inject({
      headers: { authorization: `Bearer ${accessToken}` },
      method: 'POST',
      payload: {
        color: null,
        currencyCode: 'BHD',
        currencyMinorUnitScale: 3,
        description: null,
        icon: null,
        initialBalance: '12345678901234567890.125',
        institution: null,
        name: 'Synthetic reference account',
        typeKey: 'checking-account',
      },
      url: '/api/v1/accounts',
    });

    expect(response.statusCode).toBe(201);
    const body: unknown = response.json();
    if (
      typeof body !== 'object' ||
      body === null ||
      !('id' in body) ||
      typeof body.id !== 'string'
    ) {
      throw new Error('Created account response is missing its id.');
    }
    expect(body).toMatchObject({
      currencyCode: 'BHD',
      initialBalance: '12345678901234567890.125',
      lifecycle: 'active',
      version: 1,
    });
    expect(body.id).toMatch(/^[0-9a-f-]{36}$/u);

    const accounts = await sql.query<{
      id: string;
      owner_id: string;
      initial_balance_minor_units: string;
      currency_code: string;
      currency_minor_unit_scale: number;
    }>(
      `SELECT id, owner_id, initial_balance_minor_units::text,
              currency_code, currency_minor_unit_scale
         FROM accounts WHERE id = $1`,
      [body.id],
    );
    expect(accounts.rows).toEqual([
      {
        id: body.id,
        owner_id: actorId,
        initial_balance_minor_units: '12345678901234567890125',
        currency_code: 'BHD',
        currency_minor_unit_scale: 3,
      },
    ]);

    const audit = await sql.query<{
      owner_id: string;
      actor_id: string;
      action: string;
      resource_type: string;
      resource_id: string;
    }>(
      `SELECT owner_id, actor_id, action, resource_type, resource_id
         FROM financial_audit_events WHERE resource_id = $1`,
      [body.id],
    );
    expect(audit.rows).toEqual([
      {
        owner_id: actorId,
        actor_id: actorId,
        action: 'created',
        resource_type: 'account',
        resource_id: body.id,
      },
    ]);
  });
});
