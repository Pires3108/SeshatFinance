import { Client } from 'pg';
import { describe, expect, it } from 'vitest';

import { startPostgresTestDatabase } from './start-postgres-test-database.js';

describe('PostgreSQL test fixture', () => {
  it('provides an isolated real PostgreSQL database', async (): Promise<void> => {
    const database = await startPostgresTestDatabase();
    const client = new Client({ connectionString: database.connectionString });
    try {
      await client.connect();
      const result = await client.query<{ current_database: string }>(
        'SELECT current_database()',
      );
      expect(result.rows[0]?.current_database).toBe('seshat_test');
    } finally {
      await client.end();
      await database.stop();
    }
  }, 60_000);

  it('rolls back a failed write and starts the next run without prior data', async (): Promise<void> => {
    const first = await startPostgresTestDatabase();
    try {
      const client = new Client({ connectionString: first.connectionString });
      try {
        await client.connect();
        await client.query(
          'CREATE TABLE fixture_probe (id integer PRIMARY KEY)',
        );
        await client.query('BEGIN');
        await client.query('INSERT INTO fixture_probe (id) VALUES (1)');
        await expect(
          client.query('INSERT INTO fixture_probe (id) VALUES (1)'),
        ).rejects.toMatchObject({ code: '23505' });
        await client.query('ROLLBACK');
        const afterRollback = await client.query<{ count: string }>(
          'SELECT count(*)::text AS count FROM fixture_probe',
        );
        expect(afterRollback.rows[0]?.count).toBe('0');
        await client.query('INSERT INTO fixture_probe (id) VALUES (2)');
      } finally {
        await client.end();
      }
    } finally {
      await first.stop();
    }

    const second = await startPostgresTestDatabase();
    try {
      const client = new Client({ connectionString: second.connectionString });
      try {
        await client.connect();
        const result = await client.query<{ prior_table: string | null }>(
          "SELECT to_regclass('public.fixture_probe')::text AS prior_table",
        );
        expect(result.rows[0]?.prior_table).toBeNull();
      } finally {
        await client.end();
      }
    } finally {
      await second.stop();
    }
  }, 120_000);
});
