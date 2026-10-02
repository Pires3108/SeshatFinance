import {
  CorrectOwnedManualExchangeQuoteUseCase,
  CreateManualExchangeQuoteUseCase,
  GetOwnedManualExchangeQuoteUseCase,
  ListOwnedManualExchangeQuotesUseCase,
  ManualExchangeQuoteIdempotencyConflictError,
  ManualExchangeQuoteVersionConflictError,
  OwnedManualExchangeQuoteNotFoundError,
  InvalidManualExchangeQuoteIdempotencyKeyError,
} from '@seshat/application';
import {
  InvalidManualExchangeQuoteError,
  type ManualExchangeQuote,
} from '@seshat/domain';
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Headers,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiCreatedResponse,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
  type SchemaObject,
} from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';

import { AuthenticatedActorContext } from '../auth/authenticated-actor-context.js';
import { BearerAuthGuard } from '../auth/bearer-auth.guard.js';
import { ZodValidationPipe } from '../platform/zod-validation.pipe.js';

const idSchema = z.uuid();
const idempotencyKeySchema = z.string().regex(/^[A-Za-z0-9._:-]{1,128}$/u);
const createSchema = z.object({
  effectiveAt: z.iso.datetime({ offset: true }),
  rate: z
    .string()
    .max(1000)
    .regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/u),
  source: z.string().trim().min(1).max(120),
  sourceCurrencyCode: z.enum(['BRL', 'USD', 'EUR']),
  targetCurrencyCode: z.enum(['BRL', 'USD', 'EUR']),
});
const correctionSchema = createSchema.omit({
  sourceCurrencyCode: true,
  targetCurrencyCode: true,
});
type CreateRequest = z.infer<typeof createSchema>;
type CorrectionRequest = z.infer<typeof correctionSchema>;
type QuoteResponse = Readonly<{
  authorId: string;
  effectiveAt: string;
  id: string;
  rate: string;
  recordedAt: string;
  source: string;
  sourceCurrencyCode: string;
  targetCurrencyCode: string;
  version: number;
}>;

const responseSchema: SchemaObject = {
  properties: {
    authorId: { format: 'uuid', type: 'string' },
    effectiveAt: { format: 'date-time', type: 'string' },
    id: { format: 'uuid', type: 'string' },
    rate: { type: 'string' },
    recordedAt: { format: 'date-time', type: 'string' },
    source: { type: 'string' },
    sourceCurrencyCode: { enum: ['BRL', 'USD', 'EUR'], type: 'string' },
    targetCurrencyCode: { enum: ['BRL', 'USD', 'EUR'], type: 'string' },
    version: { minimum: 1, type: 'integer' },
  },
  required: [
    'authorId',
    'effectiveAt',
    'id',
    'rate',
    'recordedAt',
    'source',
    'sourceCurrencyCode',
    'targetCurrencyCode',
    'version',
  ],
  type: 'object',
};

@Controller('manual-exchange-quotes')
@ApiTags('manual-exchange-quotes')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Bearer token missing or invalid' })
@UseGuards(BearerAuthGuard)
export class ManualExchangeQuoteController {
  public constructor(
    @Inject(CreateManualExchangeQuoteUseCase)
    private readonly createQuote: CreateManualExchangeQuoteUseCase,
    @Inject(CorrectOwnedManualExchangeQuoteUseCase)
    private readonly correctQuote: CorrectOwnedManualExchangeQuoteUseCase,
    @Inject(GetOwnedManualExchangeQuoteUseCase)
    private readonly getQuote: GetOwnedManualExchangeQuoteUseCase,
    @Inject(ListOwnedManualExchangeQuotesUseCase)
    private readonly listQuotes: ListOwnedManualExchangeQuotesUseCase,
    @Inject(AuthenticatedActorContext)
    private readonly actors: AuthenticatedActorContext,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Record an informational manual exchange quote' })
  @ApiBody({ schema: createBodySchema() })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiCreatedResponse({ schema: responseSchema })
  public async create(
    @Req() request: FastifyRequest,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body(new ZodValidationPipe(createSchema)) body: CreateRequest,
  ): Promise<QuoteResponse> {
    try {
      return mapQuote(
        await this.createQuote.execute({
          ...body,
          actorId: this.actorId(request),
          effectiveAt: new Date(body.effectiveAt),
          idempotencyKey: parseIdempotencyKey(idempotencyKey),
        }),
      );
    } catch (error) {
      throw mapError(error);
    }
  }

  @Get()
  @ApiOperation({ summary: 'List latest owned manual exchange quote versions' })
  @ApiOkResponse({ schema: { items: responseSchema, type: 'array' } })
  public async list(
    @Req() request: FastifyRequest,
  ): Promise<readonly QuoteResponse[]> {
    return (await this.listQuotes.execute(this.actorId(request))).map(mapQuote);
  }

  @Get(':quoteId')
  @ApiOperation({ summary: 'Get latest owned manual exchange quote version' })
  @ApiParam({ format: 'uuid', name: 'quoteId', type: 'string' })
  @ApiOkResponse({ schema: responseSchema })
  public async get(
    @Req() request: FastifyRequest,
    @Param('quoteId', new ZodValidationPipe(idSchema)) quoteId: string,
  ): Promise<QuoteResponse> {
    const quote = await this.getQuote.execute(quoteId, this.actorId(request));
    if (quote === null) throw new NotFoundException('Quote not found.');
    return mapQuote(quote);
  }

  @Patch(':quoteId')
  @ApiOperation({
    summary: 'Append a corrected owned manual exchange quote version',
  })
  @ApiParam({ format: 'uuid', name: 'quoteId', type: 'string' })
  @ApiBody({ schema: correctionBodySchema() })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOkResponse({ schema: responseSchema })
  public async correct(
    @Req() request: FastifyRequest,
    @Param('quoteId', new ZodValidationPipe(idSchema)) quoteId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body(new ZodValidationPipe(correctionSchema)) body: CorrectionRequest,
  ): Promise<QuoteResponse> {
    try {
      return mapQuote(
        await this.correctQuote.execute({
          ...body,
          actorId: this.actorId(request),
          effectiveAt: new Date(body.effectiveAt),
          idempotencyKey: parseIdempotencyKey(idempotencyKey),
          quoteId,
        }),
      );
    } catch (error) {
      throw mapError(error);
    }
  }

  private actorId(request: FastifyRequest): string {
    const actor = this.actors.get(request);
    if (actor === undefined) throw new UnauthorizedException();
    return actor.id;
  }
}

function mapQuote(quote: ManualExchangeQuote): QuoteResponse {
  const snapshot = quote.toSnapshot();
  return {
    authorId: snapshot.authorId,
    effectiveAt: snapshot.effectiveAt.toISOString(),
    id: snapshot.id,
    rate: snapshot.rate,
    recordedAt: snapshot.recordedAt.toISOString(),
    source: snapshot.source,
    sourceCurrencyCode: snapshot.sourceCurrencyCode,
    targetCurrencyCode: snapshot.targetCurrencyCode,
    version: snapshot.version,
  };
}

function parseIdempotencyKey(value: unknown): string {
  const parsed = idempotencyKeySchema.safeParse(value);
  if (!parsed.success)
    throw new BadRequestException('Invalid idempotency key.');
  return parsed.data;
}

function mapError(error: unknown): Error {
  if (error instanceof InvalidManualExchangeQuoteIdempotencyKeyError)
    return new BadRequestException('Invalid idempotency key.');
  if (error instanceof InvalidManualExchangeQuoteError)
    return new BadRequestException('Invalid manual exchange quote.');
  if (error instanceof OwnedManualExchangeQuoteNotFoundError)
    return new NotFoundException('Quote not found.');
  if (error instanceof ManualExchangeQuoteVersionConflictError)
    return new ConflictException('Quote changed concurrently.');
  if (error instanceof ManualExchangeQuoteIdempotencyConflictError)
    return new ConflictException('Idempotency key has a different command.');
  return error instanceof Error ? error : new Error('Unknown quote error.');
}

function createBodySchema(): SchemaObject {
  return {
    additionalProperties: false,
    properties: {
      effectiveAt: { format: 'date-time', type: 'string' },
      rate: { maxLength: 1000, type: 'string' },
      source: { maxLength: 120, minLength: 1, type: 'string' },
      sourceCurrencyCode: { enum: ['BRL', 'USD', 'EUR'], type: 'string' },
      targetCurrencyCode: { enum: ['BRL', 'USD', 'EUR'], type: 'string' },
    },
    required: [
      'effectiveAt',
      'rate',
      'source',
      'sourceCurrencyCode',
      'targetCurrencyCode',
    ],
    type: 'object',
  };
}

function correctionBodySchema(): SchemaObject {
  const schema = createBodySchema();
  const properties = { ...schema.properties };
  delete properties.sourceCurrencyCode;
  delete properties.targetCurrencyCode;
  return {
    ...schema,
    properties,
    required: ['effectiveAt', 'rate', 'source'],
  };
}
