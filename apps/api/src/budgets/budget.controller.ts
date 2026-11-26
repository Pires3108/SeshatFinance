import {
  BudgetDimensionUnavailableError,
  BudgetNotFoundError,
  BudgetOverlapError,
  BudgetVersionConflictError,
  ChangeBudgetLifecycleUseCase,
  ChangeBudgetUseCase,
  CreateBudgetUseCase,
  InvalidBudgetMonthError,
  ListBudgetsUseCase,
  type BudgetView,
} from '@seshat/application';
import {
  BudgetLifecycleError,
  InvalidBudgetError,
  InvalidCurrencyError,
  InvalidMoneyAmountError,
  type Money,
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
  Query,
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
  ApiQuery,
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

const MONTH = /^\d{4}-(?:0[1-9]|1[0-2])$/u;
const amountSchema = z
  .string()
  .max(1002)
  .regex(/^\d+(?:\.\d+)?$/u);
const idSchema = z.uuid();
const createSchema = z.object({
  currencyCode: z.string().regex(/^[A-Z]{3}$/u),
  currencyMinorUnitScale: z.number().int().min(0).max(18),
  dimension: z.object({
    id: z.uuid(),
    kind: z.enum(['category', 'cost-center', 'account']),
  }),
  effectiveFrom: z.string().regex(MONTH).optional(),
  limit: amountSchema,
  name: z.string().trim().min(1).max(120),
});
const changeSchema = z.object({
  effectiveFrom: z.string().regex(MONTH),
  expectedVersion: z.number().int().min(1),
  limit: amountSchema,
  name: z.string().trim().min(1).max(120),
});
const lifecycleSchema = z.object({
  action: z.enum(['archive', 'unarchive']),
  expectedVersion: z.number().int().min(1),
});
const monthSchema = z.string().regex(MONTH).optional();

type CreateRequest = z.infer<typeof createSchema>;
type ChangeRequest = z.infer<typeof changeSchema>;
type LifecycleRequest = z.infer<typeof lifecycleSchema>;

const money: SchemaObject = {
  properties: {
    amount: { pattern: '^-?\\d+(?:\\.\\d+)?$', type: 'string' },
    currencyCode: { pattern: '^[A-Z]{3}$', type: 'string' },
  },
  required: ['amount', 'currencyCode'],
  type: 'object',
};
const consumptionProperties: Record<string, SchemaObject> = {
  exceeded: {
    description: 'Organizational warning only; no payment is ever blocked.',
    type: 'boolean',
  },
  excess: money,
  planned: money,
  realized: money,
  remaining: money,
};
const budgetProperties: Record<string, SchemaObject> = {
  consumption: {
    description: 'Null when the budget starts after the month.',
    nullable: true,
    properties: consumptionProperties,
    required: Object.keys(consumptionProperties),
    type: 'object',
  },
  countedEntries: { minimum: 0, type: 'integer' },
  createdAt: { format: 'date-time', type: 'string' },
  currencyCode: { pattern: '^[A-Z]{3}$', type: 'string' },
  dimension: {
    properties: {
      id: { format: 'uuid', type: 'string' },
      kind: { enum: ['category', 'cost-center', 'account'], type: 'string' },
    },
    required: ['id', 'kind'],
    type: 'object',
  },
  id: { format: 'uuid', type: 'string' },
  lifecycle: { enum: ['active', 'archived'], type: 'string' },
  limits: {
    items: {
      properties: {
        effectiveFrom: { pattern: '^\\d{4}-\\d{2}$', type: 'string' },
        limit: money,
      },
      required: ['effectiveFrom', 'limit'],
      type: 'object',
    },
    type: 'array',
  },
  month: { pattern: '^\\d{4}-\\d{2}$', type: 'string' },
  name: { type: 'string' },
  otherCurrencyEntries: {
    description: 'Matching expenses in another currency, left out.',
    minimum: 0,
    type: 'integer',
  },
  updatedAt: { format: 'date-time', type: 'string' },
  version: { minimum: 1, type: 'integer' },
};
const budgetSchema: SchemaObject = {
  description:
    'A monthly spending plan for one dimension. Realized comes from the expenses of the month in the profile time zone; exceeding it is only a warning.',
  properties: budgetProperties,
  required: Object.keys(budgetProperties),
  type: 'object',
};

type MoneyResponse = Readonly<{ amount: string; currencyCode: string }>;

export type BudgetResponse = Readonly<{
  id: string;
  name: string;
  dimension: Readonly<{ kind: string; id: string }>;
  currencyCode: string;
  lifecycle: string;
  limits: readonly Readonly<{ effectiveFrom: string; limit: MoneyResponse }>[];
  month: string;
  consumption: Readonly<{
    planned: MoneyResponse;
    realized: MoneyResponse;
    remaining: MoneyResponse;
    excess: MoneyResponse;
    exceeded: boolean;
  }> | null;
  countedEntries: number;
  otherCurrencyEntries: number;
  createdAt: string;
  updatedAt: string;
  version: number;
}>;

@Controller('budgets')
@ApiTags('budgets')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Bearer token missing or invalid' })
@UseGuards(BearerAuthGuard)
export class BudgetController {
  public constructor(
    @Inject(CreateBudgetUseCase)
    private readonly createBudget: CreateBudgetUseCase,
    @Inject(ListBudgetsUseCase)
    private readonly listBudgets: ListBudgetsUseCase,
    @Inject(ChangeBudgetUseCase)
    private readonly changeBudget: ChangeBudgetUseCase,
    @Inject(ChangeBudgetLifecycleUseCase)
    private readonly changeLifecycle: ChangeBudgetLifecycleUseCase,
    @Inject(AuthenticatedActorContext)
    private readonly actors: AuthenticatedActorContext,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Declare a monthly budget for one dimension' })
  @ApiHeader(idempotencyKeyHeader)
  @ApiBody({
    schema: {
      additionalProperties: false,
      properties: {
        currencyCode: { pattern: '^[A-Z]{3}$', type: 'string' },
        currencyMinorUnitScale: { maximum: 18, minimum: 0, type: 'integer' },
        dimension: budgetProperties.dimension ?? {},
        effectiveFrom: { pattern: '^\\d{4}-\\d{2}$', type: 'string' },
        limit: { pattern: '^\\d+(?:\\.\\d+)?$', type: 'string' },
        name: { maxLength: 120, minLength: 1, type: 'string' },
      },
      required: [
        'currencyCode',
        'currencyMinorUnitScale',
        'dimension',
        'limit',
        'name',
      ],
      type: 'object',
    },
  })
  @ApiCreatedResponse({ schema: budgetSchema })
  @ApiBadRequestResponse({ description: 'Invalid budget or idempotency key' })
  @ApiNotFoundResponse({ description: 'Owned dimension not found' })
  @ApiConflictResponse({
    description:
      'An active budget already covers the dimension and currency, or the key was reused',
  })
  public async create(
    @Req() request: FastifyRequest,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body(new ZodValidationPipe(createSchema)) body: CreateRequest,
  ): Promise<BudgetResponse> {
    const key = parseIdempotencyKeyHeader(idempotencyKey);
    try {
      return mapBudget(
        await this.createBudget.execute({
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
  @ApiOperation({
    summary: 'List budgets with planned, realized, remaining and excess',
  })
  @ApiQuery({
    description: 'Civil month YYYY-MM; defaults to the current month',
    name: 'month',
    required: false,
    type: 'string',
  })
  @ApiOkResponse({ schema: { items: budgetSchema, type: 'array' } })
  public async list(
    @Req() request: FastifyRequest,
    @Query('month', new ZodValidationPipe(monthSchema))
    month: string | undefined,
  ): Promise<readonly BudgetResponse[]> {
    try {
      return (
        await this.listBudgets.execute({
          actorId: this.actorId(request),
          month,
        })
      ).map(mapBudget);
    } catch (error) {
      throw mapError(error);
    }
  }

  @Put(':budgetId')
  @ApiOperation({
    summary: 'Rename a budget and set its limit from a month on',
  })
  @ApiParam({ format: 'uuid', name: 'budgetId', type: 'string' })
  @ApiBody({
    schema: {
      additionalProperties: false,
      properties: {
        effectiveFrom: { pattern: '^\\d{4}-\\d{2}$', type: 'string' },
        expectedVersion: { minimum: 1, type: 'integer' },
        limit: { pattern: '^\\d+(?:\\.\\d+)?$', type: 'string' },
        name: { maxLength: 120, minLength: 1, type: 'string' },
      },
      required: ['effectiveFrom', 'expectedVersion', 'limit', 'name'],
      type: 'object',
    },
  })
  @ApiOkResponse({ schema: budgetSchema })
  @ApiNotFoundResponse({ description: 'Owned budget not found' })
  @ApiConflictResponse({ description: 'Budget changed by another request' })
  @ApiUnprocessableEntityResponse({ description: 'Archived budget' })
  public async change(
    @Req() request: FastifyRequest,
    @Param('budgetId', new ZodValidationPipe(idSchema)) budgetId: string,
    @Body(new ZodValidationPipe(changeSchema)) body: ChangeRequest,
  ): Promise<BudgetResponse> {
    try {
      return mapBudget(
        await this.changeBudget.execute({
          ...body,
          actorId: this.actorId(request),
          budgetId,
        }),
      );
    } catch (error) {
      throw mapError(error);
    }
  }

  @Post(':budgetId/lifecycle')
  @HttpCode(200)
  @ApiOperation({ summary: 'Archive or unarchive a budget' })
  @ApiParam({ format: 'uuid', name: 'budgetId', type: 'string' })
  @ApiBody({
    schema: {
      additionalProperties: false,
      properties: {
        action: { enum: ['archive', 'unarchive'], type: 'string' },
        expectedVersion: { minimum: 1, type: 'integer' },
      },
      required: ['action', 'expectedVersion'],
      type: 'object',
    },
  })
  @ApiOkResponse({ schema: budgetSchema })
  @ApiNotFoundResponse({ description: 'Owned budget not found' })
  @ApiConflictResponse({
    description:
      'Budget changed by another request, or unarchiving overlaps an active budget',
  })
  public async lifecycle(
    @Req() request: FastifyRequest,
    @Param('budgetId', new ZodValidationPipe(idSchema)) budgetId: string,
    @Body(new ZodValidationPipe(lifecycleSchema)) body: LifecycleRequest,
  ): Promise<BudgetResponse> {
    try {
      return mapBudget(
        await this.changeLifecycle.execute({
          ...body,
          actorId: this.actorId(request),
          budgetId,
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

function moneyOf(value: Money): MoneyResponse {
  return { amount: value.toDecimal(), currencyCode: value.currency.code };
}

export function mapBudget(view: BudgetView): BudgetResponse {
  const snapshot = view.budget.toSnapshot();
  const consumption = view.consumption;
  return {
    consumption:
      consumption === null
        ? null
        : {
            exceeded: consumption.exceeded,
            excess: moneyOf(consumption.excess),
            planned: moneyOf(consumption.planned),
            realized: moneyOf(consumption.realized),
            remaining: moneyOf(consumption.remaining),
          },
    countedEntries: view.countedEntries,
    createdAt: snapshot.createdAt.toISOString(),
    currencyCode: snapshot.currency.code,
    dimension: { ...snapshot.dimension },
    id: snapshot.id,
    lifecycle: snapshot.lifecycle,
    limits: view.budget.limits.map((item) => ({
      effectiveFrom: item.effectiveFrom,
      limit: moneyOf(item.limit),
    })),
    month: view.month,
    name: snapshot.name,
    otherCurrencyEntries: view.otherCurrencyEntries,
    updatedAt: snapshot.updatedAt.toISOString(),
    version: snapshot.version,
  };
}

function mapError(error: unknown): Error {
  const idempotencyError = mapIdempotencyError(error);
  if (idempotencyError !== undefined) return idempotencyError;
  if (error instanceof BudgetNotFoundError) {
    return new NotFoundException('Budget not found.');
  }
  if (error instanceof BudgetDimensionUnavailableError) {
    return new NotFoundException('Dimension not found.');
  }
  if (
    error instanceof BudgetOverlapError ||
    error instanceof BudgetVersionConflictError
  ) {
    return new ConflictException(error.message);
  }
  if (error instanceof BudgetLifecycleError) {
    return new UnprocessableEntityException(error.message);
  }
  if (
    error instanceof InvalidBudgetError ||
    error instanceof InvalidBudgetMonthError ||
    error instanceof InvalidCurrencyError ||
    error instanceof InvalidMoneyAmountError
  ) {
    return new BadRequestException('Invalid budget request.');
  }
  return error instanceof Error ? error : new Error('Unknown budget error.');
}
