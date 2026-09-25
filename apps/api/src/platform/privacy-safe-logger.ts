import { Inject, Injectable, type LoggerService } from '@nestjs/common';
import pino, { type Logger } from 'pino';

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
    this.logger.error(this.fields(optionalParameters), safeEvent(message));
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

  private fields(_optionalParameters: unknown[]): Record<string, string> {
    return {
      correlationId: this.context.getCorrelationId() ?? 'unavailable',
      context: 'Application',
      hasOptionalParameters: String(_optionalParameters.length > 0),
    };
  }
}

function safeEvent(_message: unknown): string {
  return typeof _message === 'string'
    ? 'application_text_event'
    : 'application_event';
}
