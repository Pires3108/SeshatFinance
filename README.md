# Seshat Finance

Seshat Finance records and organizes financial information. It never initiates or controls external financial transactions.

## Requirements

- Node.js 22
- pnpm 11.22.0 through Corepack
- Docker with Compose

## Local development

```bash
corepack enable
pnpm install
cp .env.example .env
pnpm db:bootstrap
pnpm dev
```

The bootstrap waits for PostgreSQL to become healthy, generates the Prisma client, applies the committed migrations and runs the repeatable synthetic seed. On PowerShell, copy the environment example with `Copy-Item .env.example .env`. The bootstrap accepts only the synthetic local Compose database.

If port 5432 is occupied, set `POSTGRES_PORT=55439` and update the port in `DATABASE_URL` to `55439` in `.env`, then run `pnpm db:bootstrap` again. PostgreSQL continues listening on port 5432 inside the container. Stop it with `docker compose down`; restarting the bootstrap preserves the local volume. Use only synthetic data. Removing the local volume is an explicit destructive reset.

The web app listens on `http://localhost:3000`, the API on `http://localhost:3001`, and the worker health endpoint on `http://localhost:3002/health`.
The web registration form forwards requests to the API using `SESHAT_API_URL` (defaults to `http://localhost:3001` for local development). Registration requires the Supabase settings shown in `.env.example`; login and web sessions are not available yet.

## Quality checks

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:bootstrap
```

See [the documentation index](docs/README.md) for product and architecture decisions.
