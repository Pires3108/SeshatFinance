import { parsePendingTask, verifyBearer } from '../src/core.js';
import { json, readJson } from '../src/handler.js';
import { createStoreFromEnvironment } from '../src/infrastructure.js';

export default {
  async fetch(request: Request): Promise<Response> {
    if (request.method !== 'POST')
      return json(405, { error: 'method_not_allowed' });
    if (
      !verifyBearer(
        request.headers.get('authorization'),
        process.env.AGENT_WAITER_ADMIN_SECRET ?? '',
      )
    ) {
      return json(401, { error: 'unauthorized' });
    }
    try {
      const task = parsePendingTask(await readJson(request));
      const created = await createStoreFromEnvironment().create(task);
      return created
        ? json(201, { status: 'waiting', taskHandle: task.taskHandle })
        : json(409, { error: 'task_already_exists' });
    } catch {
      return json(400, { error: 'invalid_task_registration' });
    }
  },
};
