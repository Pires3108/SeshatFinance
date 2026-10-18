import {
  type CallHandler,
  type ExecutionContext,
  Inject,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { Observable, tap } from 'rxjs';

import { CorrelationContext } from './correlation-context.js';
import { PrivacySafeLogger } from './privacy-safe-logger.js';

@Injectable()
export class CorrelationInterceptor implements NestInterceptor {
  public constructor(
    @Inject(CorrelationContext) private readonly context: CorrelationContext,
    @Inject(PrivacySafeLogger) private readonly logger: PrivacySafeLogger,
  ) {}

  public intercept(
    executionContext: ExecutionContext,
    next: CallHandler,
  ): Observable<unknown> {
    const request = executionContext
      .switchToHttp()
      .getRequest<FastifyRequest>();
    const response = executionContext
      .switchToHttp()
      .getResponse<FastifyReply>();
    const correlationId =
      this.context.getRequestCorrelationId(request) ??
      this.context.resolveIdentifier(request.headers['x-correlation-id']);

    response.header('x-correlation-id', correlationId);
    if (!this.context.getRequestCorrelationId(request))
      this.context.associateRequest(request, correlationId);
    return new Observable((subscriber) => {
      return this.context.run(correlationId, () => {
        const subscription = next
          .handle()
          .pipe(
            tap({
              next: (): void => {
                this.logger.record({
                  action: 'request_completed',
                  resourceType: 'http',
                  outcome: 'success',
                  durationMs: this.context.getRequestDuration(request),
                  correlationId,
                });
              },
            }),
          )
          .subscribe(subscriber);
        return (): void => {
          subscription.unsubscribe();
        };
      });
    });
  }
}
