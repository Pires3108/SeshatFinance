import {
  ArgumentsHost,
  Catch,
  HttpException,
  HttpStatus,
  Inject,
  type ExceptionFilter,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { CorrelationContext } from './correlation-context.js';
import { PrivacySafeLogger } from './privacy-safe-logger.js';
import { PasswordRejectedException } from './password-rejected.exception.js';

type ErrorEnvelope = Readonly<{
  error: Readonly<{
    code: string;
    message: string;
    correlationId: string;
  }>;
}>;

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  public constructor(
    @Inject(CorrelationContext) private readonly context: CorrelationContext,
    @Inject(PrivacySafeLogger) private readonly logger: PrivacySafeLogger,
  ) {}

  public catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<FastifyReply>();
    const request = host.switchToHttp().getRequest<FastifyRequest>();
    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;
    const correlationId =
      this.context.getRequestCorrelationId(request) ??
      this.context.getCorrelationId() ??
      'unavailable';
    const envelope: ErrorEnvelope = {
      error: {
        code:
          exception instanceof PasswordRejectedException
            ? 'PASSWORD_REJECTED'
            : publicErrorCode(status),
        message:
          exception instanceof PasswordRejectedException
            ? 'A senha não atende à política de segurança.'
            : publicErrorMessage(status),
        correlationId,
      },
    };

    this.logger.record({
      action: 'request_failed',
      resourceType: 'http',
      outcome: 'failure',
      durationMs: this.context.getRequestDuration(request),
      correlationId,
    });

    void response.status(status).send(envelope);
  }
}

function publicErrorCode(status: number): string {
  if (status === 400) return 'INVALID_REQUEST';
  if (status === 401) return 'UNAUTHENTICATED';
  if (status === 403) return 'FORBIDDEN';
  if (status === 404) return 'NOT_FOUND';
  if (status === 409) return 'CONFLICT';
  if (status === 429) return 'RATE_LIMITED';
  if (status === 503) return 'SERVICE_UNAVAILABLE';
  return 'INTERNAL_ERROR';
}

function publicErrorMessage(status: number): string {
  if (status === 400) return 'A solicitação é inválida.';
  if (status === 401) return 'Autenticação necessária.';
  if (status === 403) return 'Acesso não autorizado.';
  if (status === 404) return 'Recurso não encontrado.';
  if (status === 409) return 'A solicitação está em conflito.';
  if (status === 429) {
    return 'Muitas solicitações. Tente novamente mais tarde.';
  }
  if (status === 503)
    return 'O serviço está temporariamente indisponível. Tente novamente mais tarde.';
  return 'Não foi possível concluir a solicitação.';
}
