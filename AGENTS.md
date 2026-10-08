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
- If Docker or Testcontainers reports that no container runtime is available, start Docker Desktop, wait for the engine to become ready, and rerun the affected integration tests before reporting an environment limitation or leaving the verification pending.

## Change discipline

- Develop each backlog increment on its own descriptive branch; never commit directly to main.
- Keep branch scope aligned with one reviewable backlog increment and publish it before starting the next branch.
- Preserve existing identifiers in requirements and architecture documents.
- Update requirements, rules, acceptance criteria, invariants, and traceability when behavior changes.
- Keep commits small and use Conventional Commits.
- Inspect the final diff and do not overwrite unrelated user changes.

## Jira blockers

- Move a Jira item to **Bloqueado** when implementation cannot proceed safely because a product, domain, security, privacy, architectural, or acceptance-criteria decision is missing.
- Before moving it, add a concise comment identifying the unresolved decision, affected requirement or invariant, and the condition for resuming work. Do not use **Bloqueado** for ordinary implementation work, review feedback, transient environment failures, or work that can safely continue in another task.
- When the decision is recorded and the implementation can resume, move the item from **Bloqueado** to the appropriate active workflow status and add a comment linking the decision to the next implementation step.

## Jira completion per task

- Treat Jira status as a required deliverable of every task, not optional administration. Before ending work, update the corresponding Jira item with a concise evidence comment and the accurate status.
- Move an item to **Done** only when its scoped implementation is complete, the required formatting, linting, type checking and affected tests have passed, relevant financial invariants have been checked, and the work is committed and published in its reviewable branch or pull request. Include links or identifiers for the commit, pull request and verification in the Jira comment.
- If any of those completion conditions is pending, do not move the item to **Done**. Keep it in the applicable active/review status and comment precisely what remains. If a missing decision prevents safe progress, use **Bloqueado** following the blocker rules above.
- Do not finish an agent task without performing this Jira update, unless no Jira item is in scope; state that exception explicitly in the final report.

## Sprint execution cadence

- Work through all detailed BDD/Gherkin stories in the planned sprints. Triage the backlog in batches, then implement each story on its own reviewable branch without repeatedly redoing the same discovery.
- Favor focused local verification and the required quality gates. Do not spend time repeatedly checking GitHub or Jira for a response after an action has been submitted.
- Use the project's signed GitHub and Jira webhooks as the completion signal for asynchronous events. Wait for the corresponding event instead of polling either provider. If a webhook fails or is unavailable, record the failure once and continue with independent work; use a direct status check only when needed to resolve that specific failure.
- Keep moving to the next safe story after publishing each backlog increment. Document any missing decision that makes a story unsafe to implement and move that story to **Bloqueado** using the Jira blocker process above, while continuing with other stories.
