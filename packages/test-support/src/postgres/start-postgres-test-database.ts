import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';

export type PostgresTestDatabase = Readonly<{
  connectionString: string;
  stop(): Promise<void>;
}>;

export async function startPostgresTestDatabase(): Promise<PostgresTestDatabase> {
  const container: StartedPostgreSqlContainer = await new PostgreSqlContainer(
    'postgres:17-alpine',
  )
    .withDatabase('seshat_test')
    .withUsername('seshat_test')
    .withPassword('synthetic-test-password')
    .start();

  return {
    connectionString: container.getConnectionUri(),
    stop: async (): Promise<void> => {
      await container.stop();
    },
  };
}
