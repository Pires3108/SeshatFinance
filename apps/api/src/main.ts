import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify';

import { AppModule } from './app.module.js';
import { configureApplication } from './platform/configure-application.js';

export async function bootstrap(): Promise<void> {
  const application = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
  );
  configureApplication(application);

  const port = Number.parseInt(process.env.API_PORT ?? '3001', 10);
  await application.listen(port, '0.0.0.0');
}

if (process.env.NODE_ENV !== 'test') {
  await bootstrap();
}
