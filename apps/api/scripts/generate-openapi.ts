import 'reflect-metadata';

import { writeFile } from 'node:fs/promises';

import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify';

import { AppModule } from '../src/app.module.js';
import {
  configureApplication,
  createOpenApiDocument,
} from '../src/platform/configure-application.js';

const application = await NestFactory.create<NestFastifyApplication>(
  AppModule,
  new FastifyAdapter(),
  { logger: false },
);

try {
  configureApplication(application);
  await application.init();
  const document = createOpenApiDocument(application);
  await writeFile(
    new URL('../openapi.json', import.meta.url),
    `${JSON.stringify(document, null, 2)}\n`,
    'utf8',
  );
} finally {
  await application.close();
}
