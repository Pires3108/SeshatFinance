import {
  Body,
  Controller,
  Get,
  HttpException,
  Inject,
  Param,
  Post,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify';
import {
  ObservedJobRunner,
  OperationCorrelationContext,
  type SafeLogEntry,
} from '@seshat/observability';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AppModule } from '../src/app.module.js';
import { configureApplication } from '../src/platform/configure-application.js';
import { CorrelationContext } from '../src/platform/correlation-context.js';
import { PrivacySafeLogger } from '../src/platform/privacy-safe-logger.js';
import { ZodValidationPipe } from '../src/platform/zod-validation.pipe.js';

const correlationId = 'a36bf45e-2b6d-48e5-82d6-d4607bf2b4b9';
const secret =
  'SQL password=secret-marker token=token-marker otp=otp-marker amount=987654.32 email=private@example.test account=account-marker attachment=private.pdf';
const workerEntries: SafeLogEntry[] = [];

@Controller('test-errors')
class TestErrorController {
  public constructor(
    @Inject(CorrelationContext) private readonly context: CorrelationContext,
  ) {}
  @Post('validated')
  public validated(
    @Body(new ZodValidationPipe(z.object({ name: z.string().min(1) })))
    body: {
      name: string;
    },
  ): { ok: boolean } {
    return { ok: body.name.length > 0 };
  }
  @Get('async')
  public async failAsyncJob(): Promise<never> {
    await Promise.resolve();
    const runner = new ObservedJobRunner(
      new OperationCorrelationContext(),
      (entry): void => {
        workerEntries.push(entry);
      },
    );
    const metadata = JSON.parse(
      JSON.stringify(this.context.createJobMetadata()),
    ) as { correlationId: string };
    return runner.run(metadata, async (): Promise<never> => {
      await Promise.resolve();
      throw new Error(secret);
    });
  }
  @Get('status/:status')
  public async failWithStatus(@Param('status') status: string): Promise<never> {
    await Promise.resolve();
    throw new HttpException(secret, Number(status));
  }
}

describe('API error envelope and privacy', () => {
  let application: NestFastifyApplication | undefined;
  const entries: { fields: SafeLogEntry; message: string }[] = [];
  afterEach(async (): Promise<void> => {
    await application?.close();
    entries.length = 0;
    workerEntries.length = 0;
  });
  async function start(): Promise<NestFastifyApplication> {
    const module = await Test.createTestingModule({
      controllers: [TestErrorController],
      imports: [AppModule],
      providers: [CorrelationContext],
    })
      .overrideProvider(CorrelationContext)
      .useValue(new CorrelationContext())
      .compile();
    application = module.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
      { logger: false },
    );
    const capture = (fields: SafeLogEntry, message: string): void => {
      entries.push({ fields, message });
    };
    Object.defineProperty(application.get(PrivacySafeLogger), 'logger', {
      value: {
        info: capture,
        error: capture,
        warn: capture,
        debug: capture,
        trace: capture,
      },
    });
    configureApplication(application);
    await application.init();
    await application.getHttpAdapter().getInstance().ready();
    return application;
  }
  it('correlates a real asynchronous API/job failure with response and safe sinks', async () => {
    const app = await start();
    const response = await app.inject({
      headers: {
        'x-correlation-id': correlationId,
        authorization: 'Bearer token-marker',
      },
      method: 'GET',
      url: '/api/v1/test-errors/async',
    });
    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({
      error: {
        code: 'INTERNAL_ERROR',
        correlationId,
        message: 'Não foi possível concluir a solicitação.',
      },
    });
    expect(response.headers['x-correlation-id']).toBe(correlationId);
    expect(
      entries.filter((entry) => entry.fields.action === 'request_failed'),
    ).toHaveLength(1);
    expect(entries.at(-1)?.fields).toMatchObject({
      correlationId,
      resourceType: 'http',
      outcome: 'failure',
    });
    expect(workerEntries).toHaveLength(1);
    expect(workerEntries[0]).toMatchObject({
      correlationId,
      action: 'job_failed',
    });
    expect(
      JSON.stringify({ body: response.body, entries, workerEntries }),
    ).not.toMatch(
      /SQL|secret-marker|token-marker|otp-marker|987654|private@|account-marker|private\.pdf/u,
    );
  });
  it('returns a safe stable envelope for a real Zod invalid field', async () => {
    const app = await start();
    const invalid = await app.inject({
      headers: { 'x-correlation-id': correlationId },
      method: 'POST',
      url: '/api/v1/test-errors/validated',
      payload: { name: 123, token: secret },
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json()).toEqual({
      error: {
        code: 'INVALID_REQUEST',
        correlationId,
        message: 'A solicitação é inválida.',
      },
    });
    expect(JSON.stringify({ body: invalid.body, entries })).not.toMatch(
      /SQL|secret-marker|token-marker|otp-marker|987654|private@|account-marker|private\.pdf/u,
    );
  });
  it.each([
    [400, 'INVALID_REQUEST'],
    [401, 'UNAUTHENTICATED'],
    [403, 'FORBIDDEN'],
    [409, 'CONFLICT'],
    [429, 'RATE_LIMITED'],
    [503, 'SERVICE_UNAVAILABLE'],
  ] as const)('maps HTTP %s to stable safe %s', async (status, code) => {
    const app = await start();
    const response = await app.inject({
      headers: { 'x-correlation-id': correlationId },
      method: 'GET',
      url: `/api/v1/test-errors/status/${String(status)}`,
    });
    expect(response.statusCode).toBe(status);
    expect(response.json()).toMatchObject({ error: { code, correlationId } });
    expect(entries.at(-1)?.fields.correlationId).toBe(correlationId);
    expect(JSON.stringify({ body: response.body, entries })).not.toMatch(
      /SQL|secret-marker|token-marker|otp-marker|987654|private@|account-marker|private\.pdf/u,
    );
  });
  it('replaces a sensitive arbitrary correlation header without rejecting the request', async () => {
    const app = await start();
    const response = await app.inject({
      headers: { 'x-correlation-id': 'token-marker' },
      method: 'GET',
      url: '/api/v1/health',
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers['x-correlation-id']).toMatch(/^[0-9a-f-]{36}$/u);
    expect(
      JSON.stringify({
        body: response.body,
        headers: response.headers,
        entries,
      }),
    ).not.toContain('token-marker');
  });
  it('correlates authorization failure before the interceptor runs', async () => {
    const app = await start();
    const response = await app.inject({
      headers: { 'x-correlation-id': correlationId },
      method: 'GET',
      url: '/api/v1/accounts',
    });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({
      error: { code: 'UNAUTHENTICATED', correlationId },
    });
    expect(response.headers['x-correlation-id']).toBe(correlationId);
    expect(entries.at(-1)?.fields.correlationId).toBe(correlationId);
  });
});
