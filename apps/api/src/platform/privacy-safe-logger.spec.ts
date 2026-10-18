import { describe, expect, it } from 'vitest';

import type { SafeLogEntry } from '@seshat/observability';

import type { CorrelationContext } from './correlation-context.js';
import { PrivacySafeLogger } from './privacy-safe-logger.js';

type LoggedEntry = Readonly<{
  fields: SafeLogEntry;
  message: string;
  method: string;
}>;

describe('PrivacySafeLogger', () => {
  it('never sends sensitive values to its sink at any log level', () => {
    const entries: LoggedEntry[] = [];
    const logger = new PrivacySafeLogger(correlationContext());
    Object.defineProperty(logger, 'logger', {
      value: sink(entries),
    });
    const sensitiveValue =
      'password=s3cr3t bearer=eyJhbGci otp=123456 attachment=private-statement.pdf';

    logger.log(sensitiveValue, sensitiveValue);
    logger.error(sensitiveValue, sensitiveValue);
    logger.warn(sensitiveValue, sensitiveValue);
    logger.debug(sensitiveValue, sensitiveValue);
    logger.verbose(sensitiveValue, sensitiveValue);

    expect(entries).toHaveLength(5);
    for (const entry of entries) {
      expect(entry.message).toBe('application_text_event');
      expect(entry.fields).toEqual({
        action: 'application_event',
        resourceType: 'application',
        outcome: entry.method === 'error' ? 'failure' : 'success',
        durationMs: 0,
        correlationId: 'a36bf45e-2b6d-48e5-82d6-d4607bf2b4b9',
      });
      expect(JSON.stringify(entry)).not.toContain('s3cr3t');
      expect(JSON.stringify(entry)).not.toContain('eyJhbGci');
      expect(JSON.stringify(entry)).not.toContain('123456');
      expect(JSON.stringify(entry)).not.toContain('private-statement.pdf');
    }
  });
});

function correlationContext(): CorrelationContext {
  return {
    getCorrelationId: (): string => 'a36bf45e-2b6d-48e5-82d6-d4607bf2b4b9',
  } as CorrelationContext;
}

function sink(entries: LoggedEntry[]): {
  debug: (fields: SafeLogEntry, message: string) => void;
  error: (fields: SafeLogEntry, message: string) => void;
  info: (fields: SafeLogEntry, message: string) => void;
  trace: (fields: SafeLogEntry, message: string) => void;
  warn: (fields: SafeLogEntry, message: string) => void;
} {
  return {
    debug: (fields, message): void => {
      entries.push({ fields, message, method: 'debug' });
    },
    error: (fields, message): void => {
      entries.push({ fields, message, method: 'error' });
    },
    info: (fields, message): void => {
      entries.push({ fields, message, method: 'info' });
    },
    trace: (fields, message): void => {
      entries.push({ fields, message, method: 'trace' });
    },
    warn: (fields, message): void => {
      entries.push({ fields, message, method: 'warn' });
    },
  };
}
