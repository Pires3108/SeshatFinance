/** Synthetic fixtures must never be written to a production or remote database. */
export function assertSyntheticSeedTarget(
  connectionString: string | undefined,
  nodeEnvironment: string | undefined,
): string {
  if (nodeEnvironment === 'production') {
    throw new Error('Synthetic seed is prohibited in production.');
  }
  if (connectionString === undefined) {
    throw new Error('DATABASE_URL is required to run the synthetic seed.');
  }
  let target: URL;
  try {
    target = new URL(connectionString);
  } catch {
    throw new Error('A valid PostgreSQL connection URL is required.');
  }
  if (
    !['postgres:', 'postgresql:'].includes(target.protocol) ||
    !['localhost', '127.0.0.1', '[::1]'].includes(target.hostname)
  ) {
    throw new Error('Synthetic seed requires a local PostgreSQL database.');
  }
  return connectionString;
}
