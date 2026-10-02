# Seshat Finance

## Product boundary

- This application only records and organizes financial information.
- Never add capabilities that initiate, authorize, block, prevent, cancel, or modify external financial transactions.
- A confirmation records the user's declaration that an event occurred outside the application.

## Architecture

- Preserve the modular monolith: web, API, and worker.
- Keep Domain independent from frameworks, ORM, HTTP, storage, and providers.
- Presentation calls Application use cases; Infrastructure implements Application ports.
- The API is the only financial write boundary. The browser never writes financial tables directly.
- Do not access another module's internal repository or tables.
- Record significant architectural changes as ADRs.

## Financial correctness

- Never use JavaScript number for money or precision-sensitive rates.
- Money always carries an explicit currency.
- Composite financial writes must be atomic and idempotent.
- Preserve the invariants in 08-catalogo-de-invariantes-seshat-finance.md.
- Inject clocks and identifiers in domain and application code.

## Code

- Use strict TypeScript and explicit public return types.
- Use English for code, APIs, database names, logs, and commits; use pt-BR for user-facing copy.
- Use kebab-case files, PascalCase types, camelCase values, and snake_case database identifiers.
- Validate every external input and authorize every server-side action.
- Do not expose Prisma models through API contracts.
- Do not add a production dependency without justification.

## Security and privacy

- Never commit secrets or real personal financial data.
- Never log financial values, transaction descriptions, account numbers, tokens, OTPs, or attachments.
- Keep storage private and use signed URLs.
- Apply least privilege and reauthentication for sensitive operations.

## Testing

- Add regression tests with every bug fix.
- Test affected financial invariants for changes to balances, statements, installments, forecasts, imports, or net worth.
- Use unit tests for Domain, PostgreSQL integration tests for persistence, and Playwright for critical journeys.
- Run formatting, lint, type checking, and affected tests before completion.

## Agent waiting policy

- Do not use watch modes, retry loops, or periodic status checks to wait for CI
  or Jira state changes.
- For asynchronous CI and Jira work, register the pending task with the
  `agent-waiter` service and end the model turn. Resume only from its signed
  callback.
- A single diagnostic status lookup is allowed when it informs the next action;
  repeated lookups are not.

## Change discipline

- Develop each backlog increment on its own descriptive branch; never commit directly to main.
- Keep branch scope aligned with one reviewable backlog increment and publish it before starting the next branch.
- Preserve existing identifiers in requirements and architecture documents.
- Update requirements, rules, acceptance criteria, invariants, and traceability when behavior changes.
- Keep commits small and use Conventional Commits.
- Inspect the final diff and do not overwrite unrelated user changes.
