# ADR-027 — Shared authentication attempt limits

**Status:** accepted for US-018 (SESHAT-35), 03/10/2026.

## Context

The login limit must apply to a normalized email across API instances and source IPs. Five consecutive failures trigger a five-minute lock. Later locks double up to 80 minutes. The response must not reveal whether the email exists, and provider outages must not count as credential failures.

## Decision

The API stores a keyed SHA-256 HMAC of the normalized email and a failure/lock state in PostgreSQL. A row lock serializes attempts for one identity across API instances. Successful authentication clears the state. Only classified invalid credentials advance the counter; provider outages preserve it. The HMAC key is required at runtime and must be at least 32 characters. The API returns the same invalid-credentials response for rejected and locked attempts.

## Consequences

The identity provider call occurs while the row lock and database transaction are held, so transaction duration and database connection use need monitoring. The transaction has a 20-second timeout. Key rotation requires a migration strategy because existing hashes cannot be reidentified from stored data. No raw email or password is stored in the attempt-limit table.

## Alternatives considered

An in-memory counter cannot enforce a shared limit across API instances. An IP-only counter does not meet the requirement for attempts distributed across IPs. A plain email key would unnecessarily retain personal data.
