import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  startPostgresTestDatabase,
  type PostgresTestDatabase,
} from './start-postgres-test-database.js';

describe('PostgreSQL test fixture', () => {
  let database: PostgresTestDatabase | undefined;

  beforeAll(async (): Promise<void> => {
    database = await startPostgresTestDatabase();
  }, 60_000);

  afterAll(async (): Promise<void> => {
    await database?.stop();
  });

  it('provides an isolated real PostgreSQL database', async (): Promise<void> => {
    if (database === undefined) {
      throw new Error('PostgreSQL test database was not initialized.');
    }
    const client = new Client({ connectionString: database.connectionString });
    await client.connect();
    try {
      const result = await client.query<{ current_database: string }>(
        'SELECT current_database()',
      );
      expect(result.rows[0]?.current_database).toBe('seshat_test');
    } finally {
      await client.end();
    }
  });
});
