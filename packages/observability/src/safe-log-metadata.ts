import { isOpaqueCorrelationId } from './correlation-context.js';

export type SafeLogEntry = Readonly<{
  action:
    | 'application_event'
    | 'request_completed'
    | 'request_failed'
    | 'job_completed'
    | 'job_failed';
  resourceType: 'application' | 'http' | 'job';
  outcome: 'success' | 'failure';
  durationMs: number;
  correlationId: string;
}>;

export type SafeLogSink = (entry: SafeLogEntry) => void;

export function safeLogMetadata(input: SafeLogEntry): SafeLogEntry {
  return {
    action: [
      'request_completed',
      'request_failed',
      'job_completed',
      'job_failed',
    ].includes(input.action)
      ? input.action
      : 'application_event',
    resourceType:
      input.resourceType === 'http' || input.resourceType === 'job'
        ? input.resourceType
        : 'application',
    outcome: input.outcome === 'failure' ? 'failure' : 'success',
    durationMs:
      Number.isFinite(input.durationMs) && input.durationMs >= 0
        ? Math.round(input.durationMs)
        : 0,
    correlationId: isOpaqueCorrelationId(input.correlationId)
      ? input.correlationId
      : 'unavailable',
  };
}
