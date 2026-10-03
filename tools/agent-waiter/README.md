# Agent Waiter

Vercel webhook receiver for external agent tools. It validates GitHub or Jira
webhook signatures, stores only the terminal outcome or issue status for one
day, and acknowledges the delivery after storage succeeds. It does not run the
financial application and does not read or write financial data.

## Deploy

Create an Upstash Redis store through the Vercel Marketplace and connect it to
this Vercel project. Deploy this directory as its own Vercel project:

```powershell
cd tools/agent-waiter
vercel
```

Configure these secrets in Vercel for Preview and Production:

- `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`
- `GITHUB_WEBHOOK_SECRET` and `JIRA_WEBHOOK_SECRET`

Configure GitHub to send `workflow_run` and/or `check_run` events to
`https://<deployment>/api/github`; configure Jira Cloud issue-update events to
`https://<deployment>/api/jira`. Each provider must use its matching secret.

## Delivery behavior

GitHub `check_run` and `workflow_run` completion events, plus Jira issue-update
events, receive `202` only after their HMAC and minimal payload shape are
validated and the result is written to the Redis event queue. Storage failure
returns `503`, so the provider can retry. The queue contains only provider,
resource ID, event type, completion outcome or Jira status ID, and timestamps.
GitHub completions are indexed by run/check ID and commit SHA. No provider
payload or financial data is saved.

## Wait for an event from a local agent

Use the project's `REDIS_URL` from the Vercel production environment through a
local ignored environment file. Never print or commit it. Capture a UTC
timestamp before starting the operation so a past Jira status does not count as
a fresh result. The Redis `BLPOP` command blocks until the signed webhook has
written a matching event; this does not query GitHub or Jira.

```powershell
npm install
npm run build
npx vercel env pull .env.production.local --environment production --project agent-waiter --yes
node --env-file=.env.production.local scripts/wait-for-event.mjs github check_run <commit-sha> --name quality --after <start-utc>
node --env-file=.env.production.local scripts/wait-for-event.mjs jira issue_updated <numeric-issue-id> --status-id <target-status-id> --after <start-utc>
```

The command prints only the stored result. It exits 0 for a successful GitHub
check or a matching Jira status, 1 for a failed GitHub check, 3 after one hour
without an event, and 4 if the event store is unavailable. A missing event does
not prove success. This local wait command works in Codex Desktop without a
callback URL. The earlier agent-host callback contract is documented in the
ADR but is not active in this receiver version.

GitHub and Jira validate the HMAC over the raw request body before parsing it.
No provider payload or financial data is logged by this service.
