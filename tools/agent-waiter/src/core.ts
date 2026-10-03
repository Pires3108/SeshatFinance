import { createHmac, timingSafeEqual } from 'node:crypto';

export type Provider = 'github' | 'jira';
export type GitHubEvent = 'check_run' | 'workflow_run';

export interface PendingTask {
  readonly provider: Provider;
  readonly resourceId: string;
  readonly taskHandle: string;
  readonly callId: string;
  readonly resumeUrl: string;
  readonly expiresInSeconds: number;
  readonly githubEvent?: GitHubEvent;
  readonly jiraTerminalStatusIds?: readonly string[];
}

export interface Completion {
  readonly provider: Provider;
  readonly resourceId: string;
  readonly event: string;
  readonly outcome: 'success' | 'failure' | 'cancelled' | 'unknown';
  readonly completedAt: string;
  readonly statusId?: string;
  readonly observedAt?: string;
  readonly headSha?: string;
  readonly name?: string;
}

export function eventKey(
  event: Pick<Completion, 'provider' | 'resourceId' | 'event'>,
): string {
  return `agent-waiter:event:${encodeKeyPart(event.provider)}:${encodeKeyPart(event.event)}:${encodeKeyPart(event.resourceId)}`;
}

const MAX_TEXT_LENGTH = 256;

export function parsePendingTask(input: unknown): PendingTask {
  if (!isRecord(input)) throw new Error('Request body must be an object.');

  const provider = input.provider;
  if (provider !== 'github' && provider !== 'jira') {
    throw new Error('provider must be github or jira.');
  }

  const task: PendingTask = {
    provider,
    resourceId: requiredText(input.resourceId, 'resourceId'),
    taskHandle: requiredText(input.taskHandle, 'taskHandle'),
    callId: requiredText(input.callId, 'callId'),
    resumeUrl: requiredHttpsUrl(input.resumeUrl),
    expiresInSeconds: optionalInteger(input.expiresInSeconds, 3600, 60, 86_400),
  };

  if (provider === 'github') {
    if (
      input.githubEvent !== 'check_run' &&
      input.githubEvent !== 'workflow_run'
    ) {
      throw new Error(
        'githubEvent must be check_run or workflow_run for GitHub tasks.',
      );
    }
    return { ...task, githubEvent: input.githubEvent };
  }

  if (
    !Array.isArray(input.jiraTerminalStatusIds) ||
    input.jiraTerminalStatusIds.length === 0
  ) {
    throw new Error(
      'jiraTerminalStatusIds must contain at least one status id for Jira tasks.',
    );
  }
  const jiraTerminalStatusIds = input.jiraTerminalStatusIds.map((value) =>
    requiredText(value, 'jiraTerminalStatusIds item'),
  );
  return { ...task, jiraTerminalStatusIds };
}

export function taskKey(
  task: Pick<PendingTask, 'provider' | 'resourceId' | 'githubEvent'>,
): string {
  return `agent-waiter:task:${encodeKeyPart(task.provider)}:${encodeKeyPart(task.githubEvent ?? 'issue')}:${encodeKeyPart(task.resourceId)}`;
}

export function lockKey(
  task: Pick<PendingTask, 'provider' | 'resourceId' | 'githubEvent'>,
): string {
  return `${taskKey(task)}:lock`;
}

export function verifyHmac(
  body: string,
  header: string | null,
  secret: string,
): boolean {
  if (header === null || secret.length === 0) return false;
  const separator = header.indexOf('=');
  if (separator < 1) return false;
  const algorithm = header.slice(0, separator).toLowerCase();
  const signature = header.slice(separator + 1);
  if (algorithm !== 'sha256' || !/^[a-f0-9]{64}$/iu.test(signature))
    return false;
  const expected = createHmac('sha256', secret)
    .update(body, 'utf8')
    .digest('hex');
  return timingSafeEqual(
    Buffer.from(expected, 'hex'),
    Buffer.from(signature, 'hex'),
  );
}

export function verifyBearer(header: string | null, secret: string): boolean {
  if (secret.length === 0 || header === null) return false;
  const expected = `Bearer ${secret}`;
  if (header.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(header), Buffer.from(expected));
}

export function signCallback(body: string, secret: string): string {
  return `sha256=${createHmac('sha256', secret).update(body, 'utf8').digest('hex')}`;
}

export function extractGitHubCompletion(
  event: string | null,
  body: unknown,
): Completion | null {
  if (!isRecord(body) || body.action !== 'completed') return null;
  if (event === 'workflow_run' && isRecord(body.workflow_run)) {
    return completionFromGitHub(event, body.workflow_run);
  }
  if (event === 'check_run' && isRecord(body.check_run)) {
    return completionFromGitHub(event, body.check_run);
  }
  return null;
}

export function extractJiraCompletion(
  body: unknown,
): { readonly resourceId: string; readonly statusId: string } | null {
  if (!isRecord(body) || !isRecord(body.issue) || !isRecord(body.issue.fields))
    return null;
  const resourceId = body.issue.id;
  const status = body.issue.fields.status;
  if (
    typeof resourceId !== 'string' ||
    !isRecord(status) ||
    typeof status.id !== 'string'
  )
    return null;
  return { resourceId, statusId: status.id };
}

function completionFromGitHub(
  event: string,
  resource: Record<string, unknown>,
): Completion | null {
  if (typeof resource.id !== 'number' && typeof resource.id !== 'string')
    return null;
  const conclusion =
    typeof resource.conclusion === 'string' ? resource.conclusion : null;
  const completedAt =
    typeof resource.updated_at === 'string'
      ? resource.updated_at
      : new Date().toISOString();
  return {
    provider: 'github',
    resourceId: String(resource.id),
    event,
    outcome: githubOutcome(conclusion),
    completedAt,
    ...(typeof resource.head_sha === 'string'
      ? { headSha: resource.head_sha }
      : {}),
    ...(typeof resource.name === 'string' ? { name: resource.name } : {}),
  };
}

function githubOutcome(conclusion: string | null): Completion['outcome'] {
  if (
    conclusion === 'success' ||
    conclusion === 'neutral' ||
    conclusion === 'skipped'
  )
    return 'success';
  if (conclusion === 'cancelled' || conclusion === 'timed_out')
    return 'cancelled';
  if (conclusion === null) return 'unknown';
  return 'failure';
}

function requiredText(value: unknown, name: string): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > MAX_TEXT_LENGTH
  ) {
    throw new Error(
      `${name} must be a non-empty string of at most ${MAX_TEXT_LENGTH} characters.`,
    );
  }
  return value;
}

function requiredHttpsUrl(value: unknown): string {
  const text = requiredText(value, 'resumeUrl');
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new Error('resumeUrl must be a valid HTTPS URL.');
  }
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '') {
    throw new Error('resumeUrl must be a valid HTTPS URL without credentials.');
  }
  return url.toString();
}

function optionalInteger(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (value === undefined) return fallback;
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new Error(
      `expiresInSeconds must be an integer between ${minimum} and ${maximum}.`,
    );
  }
  return value;
}

function encodeKeyPart(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
