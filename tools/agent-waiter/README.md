# Agent Waiter

Vercel webhook receiver for external agent tools. It validates GitHub or Jira
webhook signatures and acknowledges valid progress events. It does not run the
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
events, receive `202` after their HMAC and minimal payload shape are validated.
The receiver does not persist deliveries, resume an agent, or infer completion.
Agents use a delivery only as a progress signal and make one current-state
lookup before declaring CI or Jira work complete.

GitHub and Jira validate the HMAC over the raw request body before parsing it.
No provider payload or financial data is logged by this service.
