import { extractJiraCompletion, verifyHmac } from '../src/core.js';
import { json } from '../src/handler.js';

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
      return json(202, { status: 'received' });
    } catch {
      return json(400, { error: 'invalid_webhook' });
    }
  },
};
