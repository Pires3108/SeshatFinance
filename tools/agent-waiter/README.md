# Agent Waiter

Vercel webhook receiver for external agent tools. It stores a short-lived pending
tool call, validates GitHub or Jira webhook signatures, then posts the terminal
result to the agent host. It does not run the financial application and does not
read or write financial data.

## Deploy

Create an Upstash Redis store through the Vercel Marketplace and connect it to
this Vercel project. Deploy this directory as its own Vercel project:

```powershell
cd tools/agent-waiter
vercel
```

Configure these secrets in Vercel for Preview and Production:

- `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`
- `AGENT_WAITER_ADMIN_SECRET` for the agent host to register tasks
- `AGENT_WAITER_CALLBACK_SECRET` shared with the agent host to verify callbacks
- `GITHUB_WEBHOOK_SECRET` and `JIRA_WEBHOOK_SECRET`

Configure GitHub to send `workflow_run` and/or `check_run` events to
`https://<deployment>/api/github`; configure Jira Cloud issue-update events to
`https://<deployment>/api/jira`. Each provider must use its matching secret.

## Agent-host contract

Before an async CI/Jira tool call, the host registers a pending task at
`POST /api/tasks` with a bearer token. It must send the provider resource ID,
the OpenAI `callId`, a unique `taskHandle`, its HTTPS `resumeUrl`, and provider
specific matching data. GitHub registrations also set `githubEvent` to
`workflow_run` or `check_run`. Jira registrations set `jiraTerminalStatusIds`.

When a terminal webhook arrives, the receiver calls `resumeUrl` with a signed
JSON body:

```json
{
  "taskHandle": "ci-run-42",
  "callId": "call_abc",
  "output": { "provider": "github", "resourceId": "42", "outcome": "success" }
}
```

The agent host verifies `X-Agent-Waiter-Signature`, treats `callId` as
idempotent, then sends the `function_call_output` on that original call ID in a
new Responses API request. The host defines `wait_for_tasks` as a synchronous
tool and must not poll while the task remains pending.

GitHub and Jira validate the HMAC over the raw request body before parsing it.
No provider payload or financial data is logged by this service.
