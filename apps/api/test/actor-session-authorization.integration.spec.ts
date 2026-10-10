import 'reflect-metadata';

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { OpaqueSessionService } from '@seshat/application';
import {
  startPostgresTestDatabase,
  type PostgresTestDatabase,
} from '@seshat/test-support';
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { configureApplication } from '../src/platform/configure-application.js';
import { PrivacySafeLogger } from '../src/platform/privacy-safe-logger.js';

const ownerId = 'b36bfe2a-f319-49a8-aade-2a536ea3af38';
const otherOwnerId = 'c36bfe2a-f319-49a8-aade-2a536ea3af38';

describe('US-016 actor resolution and ownership across HTTP and PostgreSQL', () => {
  let application: NestFastifyApplication;
  let database: PostgresTestDatabase;
  let sql: Client;
  let sessions: OpaqueSessionService;
  let ownedAccountId: string;
  let otherAccountId: string;
  const logEntries: unknown[] = [];
  const originalDatabaseUrl = process.env.DATABASE_URL;

  beforeAll(async (): Promise<void> => {
    database = await startPostgresTestDatabase();
    process.env.DATABASE_URL = database.connectionString;
    sql = new Client({ connectionString: database.connectionString });
    await sql.connect();

    for (const migration of [
      '20260920040000_create_accounts',
      '20260921210000_create_financial_audit_events',
      '20260929120000_create_user_sessions',
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

    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    application = module.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
      { logger: false },
    );
    const capture = (...entry: unknown[]): void => {
      logEntries.push(entry);
    };
    Object.defineProperty(application.get(PrivacySafeLogger), 'logger', {
      value: {
        info: capture,
        error: capture,
        warn: capture,
        debug: capture,
        trace: capture,
      },
    });
    configureApplication(application);
    await application.init();
    await application.getHttpAdapter().getInstance().ready();
    sessions = application.get(OpaqueSessionService);

    ownedAccountId = await createAccount(ownerId, 'Owned account');
    otherAccountId = await createAccount(otherOwnerId, 'Other account');
  }, 60_000);

  afterAll(async (): Promise<void> => {
    await application.close();
    await sql.end();
    await database.stop();
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabaseUrl;
  });

  async function createAccount(actorId: string, name: string): Promise<string> {
    const session = await sessions.issue(actorId);
    const response = await application.inject({
      headers: { cookie: cookie(session.token) },
      method: 'POST',
      payload: {
        color: null,
        currencyCode: 'BRL',
        currencyMinorUnitScale: 2,
        description: null,
        icon: null,
        initialBalance: '100.00',
        institution: null,
        name,
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
    return body.id;
  }

  function cookie(token: string): string {
    return `__Host-seshat_session=${token}`;
  }

  it('resolves the cookie actor and returns only that actor’s account', async (): Promise<void> => {
    const session = await sessions.issue(ownerId);
    const headers = { cookie: cookie(session.token) };
    const own = await application.inject({
      headers,
      method: 'GET',
      url: `/api/v1/accounts/${ownedAccountId}`,
    });
    expect(own.statusCode).toBe(200);
    expect(own.json()).toMatchObject({
      id: ownedAccountId,
      name: 'Owned account',
    });

    const list = await application.inject({
      headers,
      method: 'GET',
      url: '/api/v1/accounts',
    });
    expect(list.statusCode).toBe(200);
    expect(list.json()).toEqual([
      expect.objectContaining({ id: ownedAccountId }),
    ]);
    const persisted = await sql.query<{ owner_id: string }>(
      'SELECT owner_id FROM accounts WHERE id = $1',
      [ownedAccountId],
    );
    expect(persisted.rows).toEqual([{ owner_id: ownerId }]);
  });

  it.each(['missing', 'expired', 'revoked'] as const)(
    'rejects a %s session before reading protected data',
    async (state): Promise<void> => {
      const session = await sessions.issue(ownerId);
      if (state === 'expired') {
        const tokenHash = createHash('sha256')
          .update(session.token)
          .digest('hex');
        await sql.query(
          "UPDATE user_sessions SET last_seen_at = NOW() - INTERVAL '31 minutes' WHERE token_hash = $1",
          [tokenHash],
        );
      } else if (state === 'revoked') {
        await sessions.revoke(session.token);
      }
      const response = await application.inject({
        ...(state === 'missing'
          ? {}
          : { headers: { cookie: cookie(session.token) } }),
        method: 'GET',
        url: `/api/v1/accounts/${ownedAccountId}`,
      });
      expect(response.statusCode).toBe(401);
      expect(response.json()).toMatchObject({
        error: { code: 'UNAUTHENTICATED' },
      });
      expect(response.body).not.toContain('Owned account');
      expect(JSON.stringify(logEntries)).not.toContain(session.token);
    },
  );

  it('denies cross-owner reads and writes without changing the account or audit history', async (): Promise<void> => {
    const session = await sessions.issue(ownerId);
    const headers = { cookie: cookie(session.token) };
    const before = await sql.query<{ name: string; version: number }>(
      'SELECT name, version FROM accounts WHERE id = $1',
      [otherAccountId],
    );
    const auditBefore = await sql.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM financial_audit_events WHERE resource_id = $1',
      [otherAccountId],
    );

    const read = await application.inject({
      headers,
      method: 'GET',
      url: `/api/v1/accounts/${otherAccountId}`,
    });
    expect(read.statusCode).toBe(404);
    expect(read.body).not.toContain('Other account');
    const write = await application.inject({
      headers,
      method: 'PATCH',
      payload: {
        color: null,
        description: null,
        icon: null,
        institution: null,
        name: 'Unauthorized change',
        typeKey: 'checking-account',
      },
      url: `/api/v1/accounts/${otherAccountId}`,
    });
    expect(write.statusCode).toBe(404);
    expect(write.body).not.toContain('Other account');
    const after = await sql.query<{ name: string; version: number }>(
      'SELECT name, version FROM accounts WHERE id = $1',
      [otherAccountId],
    );
    const auditAfter = await sql.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM financial_audit_events WHERE resource_id = $1',
      [otherAccountId],
    );
    expect(after.rows).toEqual(before.rows);
    expect(auditAfter.rows).toEqual(auditBefore.rows);
  });
});
