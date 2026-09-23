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
docker compose up -d
pnpm dev
```

The web app listens on `http://localhost:3000`, the API on `http://localhost:3001`, and the worker health endpoint on `http://localhost:3002/health`.
The web registration form forwards requests to the API using `SESHAT_API_URL` (defaults to `http://localhost:3001` for local development). Registration requires the Supabase settings shown in `.env.example`; login and web sessions are not available yet.

## Quality checks

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

See [the documentation index](docs/README.md) for product and architecture decisions.
