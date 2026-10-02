import { extractGitHubCompletion, verifyHmac } from '../src/core.js';
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
        request.headers.get('x-hub-signature-256'),
        process.env.GITHUB_WEBHOOK_SECRET ?? '',
      )
    ) {
      return json(401, { error: 'invalid_signature' });
    }
    try {
      const event = request.headers.get('x-github-event');
      const completion = extractGitHubCompletion(
        event,
        JSON.parse(raw) as unknown,
      );
      if (completion === null) return json(202, { status: 'ignored' });
      const result = await completeAndResume(
        createStoreFromEnvironment(),
        {
          provider: 'github',
          resourceId: completion.resourceId,
          githubEvent: event === 'check_run' ? 'check_run' : 'workflow_run',
        },
        completion,
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
