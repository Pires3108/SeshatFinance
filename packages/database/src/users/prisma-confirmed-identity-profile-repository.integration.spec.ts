import { readFile } from 'node:fs/promises';

import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createPrismaClient } from '../prisma/create-prisma-client.js';
import { PrismaConfirmedIdentityProfileRepository } from './prisma-confirmed-identity-profile-repository.js';

describe('confirmed registration profile persistence', () => {
  let stop: (() => Promise<void>) | undefined;
  let disconnect: (() => Promise<void>) | undefined;
  let repository: PrismaConfirmedIdentityProfileRepository;

  beforeAll(async (): Promise<void> => {
    const container = await new PostgreSqlContainer('postgres:17-alpine')
      .withDatabase('seshat_test')
      .withUsername('seshat_test')
      .withPassword('synthetic-test-password')
      .start();
    stop = async (): Promise<void> => container.stop().then(() => undefined);
    const migrationClient = new Client({
      connectionString: container.getConnectionUri(),
    });
    await migrationClient.connect();
    for (const name of [
      '20260919210000_create_user_profiles',
      '20261009120000_registration_pending',
    ]) {
      const migration = await readFile(
        new URL(
          `../../prisma/migrations/${name}/migration.sql`,
          import.meta.url,
        ),
        'utf8',
      );
      await migrationClient.query(migration);
    }
    await migrationClient.end();
    const prisma = createPrismaClient(container.getConnectionUri());
    disconnect = async (): Promise<void> => prisma.$disconnect();
    repository = new PrismaConfirmedIdentityProfileRepository(
      () => prisma,
      () => Buffer.alloc(32, 7).toString('base64url'),
    );
  }, 60_000);

  afterAll(async (): Promise<void> => {
    await disconnect?.();
    await stop?.();
  });

  it('links a confirmed provider identity once and rejects an identity without intent', async (): Promise<void> => {
    const id = '11111111-1111-4111-8111-111111111111';
    const email = 'synthetic@example.test';
    const confirmedAt = new Date('2026-10-09T12:00:00Z');
    await repository.recordIntent(email);
    await repository.createPending(id, 'Pessoa fictícia');
    await repository.ensure(
      { id, email, displayName: 'Pessoa fictícia' },
      confirmedAt,
    );
    await repository.ensure(
      { id, email, displayName: 'Pessoa fictícia' },
      confirmedAt,
    );
    await expect(repository.exists(id)).resolves.toBe(true);
    await expect(
      repository.ensure(
        {
          id: '22222222-2222-4222-8222-222222222222',
          email: 'unknown@example.test',
          displayName: null,
        },
        confirmedAt,
      ),
    ).rejects.toThrow();
    await expect(
      repository.exists('22222222-2222-4222-8222-222222222222'),
    ).resolves.toBe(false);
  });

  it('does not confirm a pending profile after its registration intent expires', async (): Promise<void> => {
    const id = '33333333-3333-4333-8333-333333333333';
    const email = 'expired@example.test';
    await repository.recordIntent(email);
    await repository.createPending(id, 'Pessoa fictícia');

    await expect(
      repository.ensure(
        { id, email, displayName: 'Pessoa fictícia' },
        new Date(Date.now() + 8 * 24 * 60 * 60 * 1000),
      ),
    ).rejects.toThrow('Confirmed identity has no local registration intent.');
  });
});
