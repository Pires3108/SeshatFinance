# ADR-028 — Counterparty links at the transaction write boundary

**Status:** Accepted for US-028 (SESHAT-44), 2026-10-26.

## Context

Transactions may reference an owned counterparty or carry free text. A new link must reject inactive or eliminated entities and resolve a merged source to its active target. Existing links must retain their historical source. Elimination and anonymization must refuse financial links. These decisions must remain correct when writes race.

## Decision

The API remains the only financial write boundary. Domain and Application exchange optional counterparty identifiers or free text without persistence models. The counterparty migration provides a database trigger for transaction INSERT and reference-changing UPDATE, plus `counterparty_financial_link_count(owner_id, counterparty_id)` as the narrow cross-module database interface. The trigger takes a row lock, verifies ownership and active status, and redirects new links from merged sources. It leaves unchanged references intact. Counterparty Infrastructure calls the function to preview impact and to guard elimination and anonymization; it does not query the transaction repository or table directly. Elimination locks the counterparty row before counting links. The worker checks due anonymization hourly when configured with `DATABASE_URL`.

## Consequences

The trigger and function depend on the transaction table schema and must be migrated together with the optional transaction columns. PostgreSQL integration tests cover ownership, merge redirection, historical links, and elimination races. The worker requires a running process and database access to execute retention on time. Legal hold is a database-controlled signal until a separate authorized hold workflow exists. Expanded lifecycle audit events remain in US-031/RII-013.
