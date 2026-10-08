import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import {
  DocumentBuilder,
  type OpenAPIObject,
  SwaggerModule,
} from '@nestjs/swagger';

import { ApiExceptionFilter } from './api-exception.filter.js';
import { CorrelationContext } from './correlation-context.js';
import { CorrelationInterceptor } from './correlation.interceptor.js';
import { PrivacySafeLogger } from './privacy-safe-logger.js';

export function configureApplication(
  application: NestFastifyApplication,
): void {
  const correlationContext = application.get(CorrelationContext);
  const logger = application.get(PrivacySafeLogger);
  application
    .getHttpAdapter()
    .getInstance()
    .addHook('onRequest', (request, reply, done): void => {
      const correlationId = correlationContext.resolveIdentifier(
        request.headers['x-correlation-id'],
      );
      correlationContext.associateRequest(request, correlationId);
      reply.header('x-correlation-id', correlationId);
      correlationContext.run(correlationId, done);
    });
  application.setGlobalPrefix('api/v1');
  application.useGlobalInterceptors(
    new CorrelationInterceptor(correlationContext, logger),
  );
  application.useGlobalFilters(
    new ApiExceptionFilter(correlationContext, logger),
  );
  application.useLogger(application.get(PrivacySafeLogger));
  application.enableShutdownHooks();

  const document = createOpenApiDocument(application);
  SwaggerModule.setup('api/docs', application, document);
}

export function createOpenApiDocument(
  application: NestFastifyApplication,
): OpenAPIObject {
  return SwaggerModule.createDocument(
    application,
    new DocumentBuilder()
      .setTitle('Seshat Finance API')
      .setDescription('API para registrar e organizar informações financeiras.')
      .setVersion('1.0')
      .addBearerAuth()
      .build(),
  );
}
