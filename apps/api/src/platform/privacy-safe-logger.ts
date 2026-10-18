import { Inject, Injectable, type LoggerService } from '@nestjs/common';
import pino, { type Logger } from 'pino';
import { safeLogMetadata, type SafeLogEntry } from '@seshat/observability';

import { CorrelationContext } from './correlation-context.js';

@Injectable()
export class PrivacySafeLogger implements LoggerService {
  private readonly logger: Logger = pino({
    level: process.env.LOG_LEVEL ?? 'info',
    base: {
      service: 'api',
      environment: process.env.NODE_ENV ?? 'development',
    },
  });

  public constructor(
    @Inject(CorrelationContext) private readonly context: CorrelationContext,
  ) {}

  public log(message: unknown, ...optionalParameters: unknown[]): void {
    this.logger.info(this.fields(optionalParameters), safeEvent(message));
  }

  public error(message: unknown, ...optionalParameters: unknown[]): void {
    this.logger.error(
      this.fields(optionalParameters, 'failure'),
      safeEvent(message),
    );
  }

  public warn(message: unknown, ...optionalParameters: unknown[]): void {
    this.logger.warn(this.fields(optionalParameters), safeEvent(message));
  }

  public debug(message: unknown, ...optionalParameters: unknown[]): void {
    this.logger.debug(this.fields(optionalParameters), safeEvent(message));
  }

  public verbose(message: unknown, ...optionalParameters: unknown[]): void {
    this.logger.trace(this.fields(optionalParameters), safeEvent(message));
  }

  public record(entry: SafeLogEntry): void {
    const metadata = safeLogMetadata(entry);
    if (metadata.outcome === 'failure')
      this.logger.error(metadata, metadata.action);
    else this.logger.info(metadata, metadata.action);
  }

  private fields(
    _optionalParameters: unknown[],
    outcome: 'success' | 'failure' = 'success',
  ): SafeLogEntry {
    return safeLogMetadata({
      correlationId: this.context.getCorrelationId() ?? 'unavailable',
      action: 'application_event',
      resourceType: 'application',
      outcome,
      durationMs: 0,
    });
  }
}

function safeEvent(_message: unknown): string {
  return typeof _message === 'string'
    ? 'application_text_event'
    : 'application_event';
}
