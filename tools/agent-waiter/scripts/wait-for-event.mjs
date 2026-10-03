#!/usr/bin/env node

import { createClient } from 'redis';

import { eventKey } from '../dist/src/core.js';

const [provider, event, resourceId, ...flags] = process.argv.slice(2);
const name = option(flags, '--name');
const statusId = option(flags, '--status-id');
const after = option(flags, '--after');
const redisUrl = process.env.REDIS_URL;

if (
  !['github', 'jira'].includes(provider) ||
  typeof event !== 'string' ||
  typeof resourceId !== 'string' ||
  resourceId.length === 0 ||
  typeof redisUrl !== 'string' ||
  redisUrl.length === 0 ||
  (after !== undefined && Number.isNaN(Date.parse(after)))
) {
  process.stderr.write(
    'Usage: REDIS_URL=... npm run wait:event -- github check_run <run-id-or-sha> [--name quality] [--after ISO-8601]\n' +
      '   or: REDIS_URL=... npm run wait:event -- jira issue_updated <issue-id> --status-id <id> --after ISO-8601\n',
  );
  process.exit(2);
}

const key = eventKey({ provider, event, resourceId });
const client = createClient({ url: redisUrl }).on('error', () => {
  process.stderr.write('Webhook event store connection failed.\n');
});

try {
  await client.connect();
  while (true) {
    const item = await client.blPop(key, 3600);
    if (item === null) {
      process.stderr.write(
        'No matching webhook event arrived within one hour.\n',
      );
      process.exitCode = 3;
      break;
    }
    const completion = JSON.parse(item.element);
    if (completion.provider !== provider || completion.event !== event)
      continue;
    if (
      completion.resourceId !== resourceId &&
      completion.headSha !== resourceId
    )
      continue;
    if (name !== undefined && completion.name !== name) continue;
    if (statusId !== undefined && completion.statusId !== statusId) continue;
    if (after !== undefined) {
      const observedAt = Date.parse(completion.observedAt ?? '');
      if (Number.isNaN(observedAt) || observedAt < Date.parse(after)) continue;
    }
    process.stdout.write(`${JSON.stringify(completion)}\n`);
    if (provider === 'github' && completion.outcome !== 'success') {
      process.exitCode = 1;
    }
    break;
  }
} catch {
  process.stderr.write('Could not read the webhook event store.\n');
  process.exitCode = 4;
} finally {
  client.destroy();
}

function option(values, name) {
  const index = values.indexOf(name);
  return index === -1 ? undefined : values[index + 1];
}
