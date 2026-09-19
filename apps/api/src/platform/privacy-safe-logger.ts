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

  private fields(optionalParameters: unknown[]): Record<string, string> {
    const context = optionalParameters.find(
      (parameter): parameter is string => typeof parameter === 'string',
    );
    return {
      correlationId: this.context.getCorrelationId() ?? 'unavailable',
      context: context ?? 'Application',
    };
  }
}

function safeEvent(message: unknown): string {
  return typeof message === 'string' ? message : 'application_event';
}
