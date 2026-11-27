import {
  ChangeInvestmentLifecycleUseCase,
  CreateInvestmentUseCase,
  GetInvestmentUseCase,
  InvestmentNotFoundError,
  InvestmentVersionConflictError,
  ListInvestmentsUseCase,
  UpdateInvestmentUseCase,
} from '@seshat/application';
import {
  InvalidCivilDateError,
  InvalidCurrencyError,
  InvalidInvestmentError,
  InvalidInvestmentTypeError,
  InvestmentLifecycleError,
  investmentIndexers,
  investmentLifecycles,
  investmentTypeKeys,
  MAX_LIQUIDITY_DAYS,
  type Investment,
} from '@seshat/domain';
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Post,
  Put,
  Req,
  UnauthorizedException,
  UnprocessableEntityException,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
  type SchemaObject,
} from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';

import { AuthenticatedActorContext } from '../auth/authenticated-actor-context.js';
import { BearerAuthGuard } from '../auth/bearer-auth.guard.js';
import {
  idempotencyKeyHeader,
  mapIdempotencyError,
  parseIdempotencyKeyHeader,
} from '../platform/idempotency-key.js';
import { ZodValidationPipe } from '../platform/zod-validation.pipe.js';

const DATE = /^\d{4}-\d{2}-\d{2}$/u;
const DECIMAL = /^\d+(?:\.\d+)?$/u;
const idSchema = z.uuid();
const liquiditySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('daily') }),
  z.object({ kind: z.literal('at-maturity') }),
  z.object({
    days: z.number().int().min(0).max(MAX_LIQUIDITY_DAYS),
    kind: z.literal('d-plus'),
  }),
]);
const detailsSchema = z.object({
  code: z.string().max(20).nullable().optional(),
  contractedRate: z
    .object({
      indexer: z.enum(investmentIndexers),
      percent: z.string().max(24).regex(DECIMAL),
    })
    .nullable()
    .optional(),
  currencyCode: z.string().regex(/^[A-Z]{3}$/u),
  currencyMinorUnitScale: z.number().int().min(0).max(18),
  institution: z.string().trim().min(1).max(120),
  liquidity: liquiditySchema,
  maturityDate: z.string().regex(DATE).nullable().optional(),
  name: z.string().trim().min(1).max(120),
  startDate: z.string().regex(DATE),
  type: z.enum(investmentTypeKeys),
});
const updateSchema = detailsSchema.extend({
  expectedVersion: z.number().int().min(1),
});
const lifecycleSchema = z.object({
  action: z.enum(['archive', 'unarchive', 'trash', 'restore']),
  expectedVersion: z.number().int().min(1),
});

type DetailsRequest = z.infer<typeof detailsSchema>;
type UpdateRequest = z.infer<typeof updateSchema>;
type LifecycleRequest = z.infer<typeof lifecycleSchema>;

const liquidityDoc: SchemaObject = {
  description:
    'daily, at-maturity (needs a maturity date) or d-plus with business days.',
  properties: {
    days: { maximum: MAX_LIQUIDITY_DAYS, minimum: 0, type: 'integer' },
    kind: { enum: ['daily', 'at-maturity', 'd-plus'], type: 'string' },
  },
  required: ['kind'],
  type: 'object',
};
const rateDoc: SchemaObject = {
  description:
    'Descriptive contracted rate; never used to compute cost, value or return.',
  nullable: true,
  properties: {
    indexer: { enum: [...investmentIndexers], type: 'string' },
    percent: { pattern: '^\\d+(?:\\.\\d+)?$', type: 'string' },
  },
  required: ['indexer', 'percent'],
  type: 'object',
};
const detailsDoc: Record<string, SchemaObject> = {
  code: { maxLength: 20, nullable: true, type: 'string' },
  contractedRate: rateDoc,
  currencyCode: { pattern: '^[A-Z]{3}$', type: 'string' },
  currencyMinorUnitScale: { maximum: 18, minimum: 0, type: 'integer' },
  institution: { maxLength: 120, minLength: 1, type: 'string' },
  liquidity: liquidityDoc,
  maturityDate: { format: 'date', nullable: true, type: 'string' },
  name: { maxLength: 120, minLength: 1, type: 'string' },
  startDate: { format: 'date', type: 'string' },
  type: { enum: [...investmentTypeKeys], type: 'string' },
};
const requiredDetails = [
  'currencyCode',
  'currencyMinorUnitScale',
  'institution',
  'liquidity',
  'name',
  'startDate',
  'type',
];
const investmentProperties: Record<string, SchemaObject> = {
  ...detailsDoc,
  createdAt: { format: 'date-time', type: 'string' },
  id: { format: 'uuid', type: 'string' },
  lifecycle: { enum: [...investmentLifecycles], type: 'string' },
  quantityScale: {
    description:
      'Maximum decimal places of a quantity for the type; null when the type is tracked only by value.',
    nullable: true,
    type: 'integer',
  },
  updatedAt: { format: 'date-time', type: 'string' },
  version: { minimum: 1, type: 'integer' },
};
const investmentSchema: SchemaObject = {
  description:
    'A manually declared investment. Seshat Finance only records it; nothing is executed at any institution.',
  properties: investmentProperties,
  required: Object.keys(investmentProperties),
  type: 'object',
};

export type InvestmentResponse = Readonly<{
  id: string;
  type: string;
  institution: string;
  name: string;
  code: string | null;
  currencyCode: string;
  currencyMinorUnitScale: number;
  startDate: string;
  maturityDate: string | null;
  contractedRate: Readonly<{ indexer: string; percent: string }> | null;
  liquidity: Readonly<{ kind: string; days?: number }>;
  lifecycle: string;
  quantityScale: number | null;
  createdAt: string;
  updatedAt: string;
  version: number;
}>;

@Controller('investments')
@ApiTags('investments')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Bearer token missing or invalid' })
@UseGuards(BearerAuthGuard)
export class InvestmentController {
  public constructor(
    @Inject(CreateInvestmentUseCase)
    private readonly createInvestment: CreateInvestmentUseCase,
    @Inject(ListInvestmentsUseCase)
    private readonly listInvestments: ListInvestmentsUseCase,
    @Inject(GetInvestmentUseCase)
    private readonly getInvestment: GetInvestmentUseCase,
    @Inject(UpdateInvestmentUseCase)
    private readonly updateInvestment: UpdateInvestmentUseCase,
    @Inject(ChangeInvestmentLifecycleUseCase)
    private readonly changeLifecycle: ChangeInvestmentLifecycleUseCase,
    @Inject(AuthenticatedActorContext)
    private readonly actors: AuthenticatedActorContext,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Register a manual investment' })
  @ApiHeader(idempotencyKeyHeader)
  @ApiBody({
    schema: {
      additionalProperties: false,
      properties: detailsDoc,
      required: requiredDetails,
      type: 'object',
    },
  })
  @ApiCreatedResponse({ schema: investmentSchema })
  @ApiBadRequestResponse({
    description: 'Invalid investment or idempotency key',
  })
  @ApiConflictResponse({ description: 'Idempotency key reused' })
  public async create(
    @Req() request: FastifyRequest,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body(new ZodValidationPipe(detailsSchema)) body: DetailsRequest,
  ): Promise<InvestmentResponse> {
    const key = parseIdempotencyKeyHeader(idempotencyKey);
    try {
      return mapInvestment(
        await this.createInvestment.execute({
          ...body,
          actorId: this.actorId(request),
          idempotencyKey: key,
        }),
      );
    } catch (error) {
      throw mapError(error);
    }
  }

  @Get()
  @ApiOperation({ summary: 'List the holder investments' })
  @ApiOkResponse({ schema: { items: investmentSchema, type: 'array' } })
  public async list(
    @Req() request: FastifyRequest,
  ): Promise<readonly InvestmentResponse[]> {
    return (await this.listInvestments.execute(this.actorId(request))).map(
      mapInvestment,
    );
  }

  @Get(':investmentId')
  @ApiOperation({ summary: 'Read one owned investment' })
  @ApiParam({ format: 'uuid', name: 'investmentId', type: 'string' })
  @ApiOkResponse({ schema: investmentSchema })
  @ApiNotFoundResponse({ description: 'Owned investment not found' })
  public async get(
    @Req() request: FastifyRequest,
    @Param('investmentId', new ZodValidationPipe(idSchema))
    investmentId: string,
  ): Promise<InvestmentResponse> {
    try {
      return mapInvestment(
        await this.getInvestment.execute({
          actorId: this.actorId(request),
          investmentId,
        }),
      );
    } catch (error) {
      throw mapError(error);
    }
  }

  @Put(':investmentId')
  @ApiOperation({
    summary: 'Edit the descriptive data; type and currency stay fixed',
  })
  @ApiParam({ format: 'uuid', name: 'investmentId', type: 'string' })
  @ApiBody({
    schema: {
      additionalProperties: false,
      properties: {
        ...detailsDoc,
        expectedVersion: { minimum: 1, type: 'integer' },
      },
      required: [...requiredDetails, 'expectedVersion'],
      type: 'object',
    },
  })
  @ApiOkResponse({ schema: investmentSchema })
  @ApiBadRequestResponse({ description: 'Invalid investment' })
  @ApiNotFoundResponse({ description: 'Owned investment not found' })
  @ApiConflictResponse({ description: 'Investment changed by another request' })
  @ApiUnprocessableEntityResponse({
    description: 'Archived or trashed investment',
  })
  public async update(
    @Req() request: FastifyRequest,
    @Param('investmentId', new ZodValidationPipe(idSchema))
    investmentId: string,
    @Body(new ZodValidationPipe(updateSchema)) body: UpdateRequest,
  ): Promise<InvestmentResponse> {
    try {
      return mapInvestment(
        await this.updateInvestment.execute({
          ...body,
          actorId: this.actorId(request),
          investmentId,
        }),
      );
    } catch (error) {
      throw mapError(error);
    }
  }

  @Post(':investmentId/lifecycle')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Archive, unarchive, move to trash or restore an investment',
  })
  @ApiParam({ format: 'uuid', name: 'investmentId', type: 'string' })
  @ApiBody({
    schema: {
      additionalProperties: false,
      properties: {
        action: {
          enum: ['archive', 'unarchive', 'trash', 'restore'],
          type: 'string',
        },
        expectedVersion: { minimum: 1, type: 'integer' },
      },
      required: ['action', 'expectedVersion'],
      type: 'object',
    },
  })
  @ApiOkResponse({ schema: investmentSchema })
  @ApiNotFoundResponse({ description: 'Owned investment not found' })
  @ApiConflictResponse({ description: 'Investment changed by another request' })
  @ApiUnprocessableEntityResponse({
    description: 'Transition not allowed from the current lifecycle',
  })
  public async lifecycle(
    @Req() request: FastifyRequest,
    @Param('investmentId', new ZodValidationPipe(idSchema))
    investmentId: string,
    @Body(new ZodValidationPipe(lifecycleSchema)) body: LifecycleRequest,
  ): Promise<InvestmentResponse> {
    try {
      return mapInvestment(
        await this.changeLifecycle.execute({
          ...body,
          actorId: this.actorId(request),
          investmentId,
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

export function mapInvestment(investment: Investment): InvestmentResponse {
  const snapshot = investment.toSnapshot();
  return {
    code: snapshot.code,
    contractedRate:
      snapshot.contractedRate === null ? null : { ...snapshot.contractedRate },
    createdAt: snapshot.createdAt.toISOString(),
    currencyCode: snapshot.currency.code,
    currencyMinorUnitScale: snapshot.currency.minorUnitScale,
    id: snapshot.id,
    institution: snapshot.institution,
    lifecycle: snapshot.lifecycle,
    liquidity: { ...snapshot.liquidity },
    maturityDate: snapshot.maturityDate,
    name: snapshot.name,
    quantityScale: investment.quantityScale,
    startDate: snapshot.startDate,
    type: snapshot.type,
    updatedAt: snapshot.updatedAt.toISOString(),
    version: snapshot.version,
  };
}

function mapError(error: unknown): Error {
  const idempotencyError = mapIdempotencyError(error);
  if (idempotencyError !== undefined) return idempotencyError;
  if (error instanceof InvestmentNotFoundError) {
    return new NotFoundException('Investment not found.');
  }
  if (error instanceof InvestmentVersionConflictError) {
    return new ConflictException(error.message);
  }
  if (error instanceof InvestmentLifecycleError) {
    return new UnprocessableEntityException(error.message);
  }
  if (
    error instanceof InvalidInvestmentError ||
    error instanceof InvalidInvestmentTypeError ||
    error instanceof InvalidCurrencyError ||
    error instanceof InvalidCivilDateError
  ) {
    return new BadRequestException('Invalid investment request.');
  }
  return error instanceof Error
    ? error
    : new Error('Unknown investment error.');
}
