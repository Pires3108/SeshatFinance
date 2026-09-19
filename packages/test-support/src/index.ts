export { SequenceIdentifierGenerator } from './identifiers/sequence-identifier-generator.js';
export { FixedClock } from './time/fixed-clock.js';
/** Deterministic fixtures and test doubles shared by multiple consumers. */
export const testSupportPackage = '@seshat/test-support' as const;
export { SYNTHETIC_USER_ID } from './fixtures/synthetic-identifiers.js';
export {
  startPostgresTestDatabase,
  type PostgresTestDatabase,
} from './postgres/start-postgres-test-database.js';
