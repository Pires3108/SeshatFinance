import { extractJiraCompletion, taskKey, verifyHmac } from '../src/core.js';
import { completeAndResume, json } from '../src/handler.js';
import { createStoreFromEnvironment } from '../src/infrastructure.js';

export default {
  async fetch(request: Request): Promise<Response> {
    if (request.method !== 'POST')
      return json(405, { error: 'method_not_allowed' });
    const raw = await request.text();
    if (
      !verifyHmac(
        raw,
        request.headers.get('x-hub-signature'),
        process.env.JIRA_WEBHOOK_SECRET ?? '',
      )
    ) {
      return json(401, { error: 'invalid_signature' });
    }
    try {
      const event = extractJiraCompletion(JSON.parse(raw) as unknown);
      if (event === null) return json(202, { status: 'ignored' });
      const store = createStoreFromEnvironment();
      const task = await store.get(
        taskKey({ provider: 'jira', resourceId: event.resourceId }),
      );
      if (
        task === null ||
        !task.jiraTerminalStatusIds?.includes(event.statusId)
      )
        return json(202, { status: 'ignored' });
      const result = await completeAndResume(
        store,
        { provider: 'jira', resourceId: event.resourceId },
        {
          provider: 'jira',
          resourceId: event.resourceId,
          event: 'issue_updated',
          outcome: 'success',
          completedAt: new Date().toISOString(),
        },
        process.env.AGENT_WAITER_CALLBACK_SECRET ?? '',
      );
      return result === 'retry'
        ? json(502, { error: 'resume_unavailable' })
        : json(202, { status: result });
    } catch {
      return json(400, { error: 'invalid_webhook' });
    }
  },
};
