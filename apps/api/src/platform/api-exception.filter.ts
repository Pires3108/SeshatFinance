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
        code: publicErrorCode(status),
        message: publicErrorMessage(status),
        correlationId,
      },
    };

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
  return 'Não foi possível concluir a solicitação.';
}
