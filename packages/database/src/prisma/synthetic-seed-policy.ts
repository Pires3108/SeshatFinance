/** Synthetic fixtures must never be written to a production or remote database. */
export function assertSyntheticSeedTarget(
  connectionString: string | undefined,
  nodeEnvironment: string | undefined,
  seedAuthorization: string | undefined,
): string {
  if (nodeEnvironment === 'production') {
    throw new Error('Synthetic seed is prohibited in production.');
  }
  if (seedAuthorization !== '1') {
    throw new Error('Synthetic seed requires explicit authorization.');
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
  if (!['postgres:', 'postgresql:'].includes(target.protocol)) {
    throw new Error('Synthetic seed requires a local PostgreSQL database.');
  }
  const localHost = ['localhost', '127.0.0.1', '[::1]'].includes(
    target.hostname,
  );
  const localCompose =
    (nodeEnvironment === undefined || nodeEnvironment === 'development') &&
    target.pathname === '/seshat' &&
    target.username === 'seshat' &&
    target.password === 'seshat';
  const integrationFixture =
    nodeEnvironment === 'test' &&
    ['migration_empty', 'migration_upgrade'].includes(
      target.pathname.slice(1),
    ) &&
    target.username === 'synthetic' &&
    target.password === 'synthetic-test-password';
  if (!localHost || (!localCompose && !integrationFixture)) {
    throw new Error('Synthetic seed requires an approved local fixture.');
  }
  return connectionString;
}
