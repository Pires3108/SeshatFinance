# @seshat/contracts

Stable public API contracts. This package must not expose persistence models or application internals.

The `openapi-typescript` development dependency generates immutable, runtime-free types from the API's committed OpenAPI document. The small `openapi-fetch` runtime dependency provides a typed Fetch API client without duplicating server contracts.

Run `pnpm client:generate` after the API contract changes. CI runs `pnpm client:check` and rejects generated types that drift from `apps/api/openapi.json`.
