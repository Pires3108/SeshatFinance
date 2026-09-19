import { randomUUID } from 'node:crypto';

import {
  type CallHandler,
  type ExecutionContext,
  Inject,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { Observable } from 'rxjs';

import { CorrelationContext } from './correlation-context.js';

const CORRELATION_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/u;

@Injectable()
export class CorrelationInterceptor implements NestInterceptor {
  public constructor(
    @Inject(CorrelationContext) private readonly context: CorrelationContext,
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
    const supplied = request.headers['x-correlation-id'];
    const correlationId =
      typeof supplied === 'string' && CORRELATION_ID_PATTERN.test(supplied)
        ? supplied
        : randomUUID();

    response.header('x-correlation-id', correlationId);
    this.context.associateRequest(request, correlationId);
    return new Observable((subscriber) => {
      return this.context.run(correlationId, () => {
        const subscription = next.handle().subscribe(subscriber);
        return (): void => {
          subscription.unsubscribe();
        };
      });
    });
  }
}
