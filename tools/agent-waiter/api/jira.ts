import { extractJiraCompletion, verifyHmac } from '../src/core.js';
import { json } from '../src/handler.js';
import { createStoreFromEnvironment } from '../src/infrastructure.js';

export default {
  async fetch(request: Request): Promise<Response> {
    if (request.method !== 'POST')
      return json(405, { error: 'method_not_allowed' });
    const raw = await request.text();
    const signature = request.headers.get('x-hub-signature');
    const secret = process.env.JIRA_WEBHOOK_SECRET ?? '';
    if (!verifyHmac(raw, signature, secret)) {
      console.warn('jira_webhook_signature_rejected', {
        signaturePresent: signature !== null,
        signatureMethod: signature?.split('=', 1)[0] ?? null,
        secretConfigured: secret.length > 0,
      });
      return json(401, { error: 'invalid_signature' });
    }
    let event;
    try {
      event = extractJiraCompletion(JSON.parse(raw) as unknown);
      if (event === null) return json(202, { status: 'ignored' });
    } catch {
      return json(400, { error: 'invalid_webhook' });
    }
    try {
      await createStoreFromEnvironment().publishCompletion({
        provider: 'jira',
        resourceId: event.resourceId,
        event: 'issue_updated',
        outcome: 'unknown',
        completedAt: new Date().toISOString(),
        observedAt: new Date().toISOString(),
        statusId: event.statusId,
      });
      return json(202, { status: 'recorded' });
    } catch {
      return json(503, { error: 'event_store_unavailable' });
    }
  },
};
