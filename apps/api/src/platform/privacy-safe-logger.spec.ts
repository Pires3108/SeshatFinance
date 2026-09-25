import { describe, expect, it } from 'vitest';

import type { CorrelationContext } from './correlation-context.js';
import { PrivacySafeLogger } from './privacy-safe-logger.js';

type LoggedEntry = Readonly<{
  fields: Record<string, string>;
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
        context: 'Application',
        correlationId: 'correlation-id',
        hasOptionalParameters: 'true',
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
    getCorrelationId: (): string => 'correlation-id',
  } as CorrelationContext;
}

function sink(entries: LoggedEntry[]): {
  debug: (fields: Record<string, string>, message: string) => void;
  error: (fields: Record<string, string>, message: string) => void;
  info: (fields: Record<string, string>, message: string) => void;
  trace: (fields: Record<string, string>, message: string) => void;
  warn: (fields: Record<string, string>, message: string) => void;
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
