# @seshat/test-support

Synthetic fixtures and deterministic test doubles shared by multiple test suites. Never add real personal or financial data.

`startPostgresTestDatabase` starts an isolated PostgreSQL 17 container for persistence tests. Unit tests exclude `*.integration.spec.ts`; run integration tests explicitly with `pnpm test:integration`. Testcontainers and `pg` are development-only dependencies used to exercise the real database engine required by the test strategy.
