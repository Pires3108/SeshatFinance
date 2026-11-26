import {
  ChangeGoalLifecycleUseCase,
  CreateGoalUseCase,
  GetAccountGoalImpactUseCase,
  GetGoalUseCase,
  GoalAccountUnavailableError,
  GoalNotFoundError,
  GoalShareConflictError,
  GoalShareCurrencyError,
  GoalShareExceedsBalanceError,
  GoalVersionConflictError,
  ListGoalsUseCase,
  UnlinkGoalAccountUseCase,
  UpdateGoalUseCase,
  type GoalDetailsInput,
  type GoalView,
} from '@seshat/application';
import {
  GoalLifecycleError,
  InvalidCivilDateError,
  InvalidCurrencyError,
  InvalidGoalError,
  InvalidMoneyAmountError,
  type GoalConversion,
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

const DECIMAL = /^\d+(?:\.\d+)?$/u;
const idSchema = z.uuid();
const amountSchema = z.string().max(1002).regex(DECIMAL);
const shareSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('full') }),
  z.object({ amount: amountSchema, kind: z.literal('amount') }),
]);
const detailsSchema = z.object({
  currencyCode: z.string().regex(/^[A-Z]{3}$/u),
  currencyMinorUnitScale: z.number().int().min(0).max(18),
  deadline: z.iso.date().nullable().optional(),
  initialAmount: amountSchema.nullable().optional(),
  links: z.array(z.object({ accountId: z.uuid(), share: shareSchema })).max(20),
  mode: z.enum(['free', 'linked']),
  name: z.string().trim().min(1).max(120),
  target: amountSchema,
});
const updateSchema = detailsSchema.extend({
  expectedVersion: z.number().int().min(1),
});
const lifecycleSchema = z.object({
  action: z.enum(['pause', 'resume', 'archive', 'unarchive']),
  expectedVersion: z.number().int().min(1),
});
const unlinkSchema = z.object({
  accountId: z.uuid(),
  expectedVersion: z.number().int().min(1),
});

type DetailsRequest = z.infer<typeof detailsSchema>;
type UpdateRequest = z.infer<typeof updateSchema>;
type LifecycleRequest = z.infer<typeof lifecycleSchema>;
type UnlinkRequest = z.infer<typeof unlinkSchema>;

const decimal = { pattern: '^-?\\d+(?:\\.\\d+)?$', type: 'string' } as const;
const plainDecimal = { pattern: '^\\d+(?:\\.\\d+)?$', type: 'string' } as const;
const money: SchemaObject = {
  properties: { amount: decimal, currencyCode: { type: 'string' } },
  required: ['amount', 'currencyCode'],
  type: 'object',
};
const shareJson: SchemaObject = {
  oneOf: [
    {
      additionalProperties: false,
      properties: { kind: { enum: ['full'], type: 'string' } },
      required: ['kind'],
      type: 'object',
    },
    {
      additionalProperties: false,
      properties: {
        amount: plainDecimal,
        kind: { enum: ['amount'], type: 'string' },
      },
      required: ['amount', 'kind'],
      type: 'object',
    },
  ],
};
const detailsProperties: Record<string, SchemaObject> = {
  currencyCode: { pattern: '^[A-Z]{3}$', type: 'string' },
  currencyMinorUnitScale: { maximum: 18, minimum: 0, type: 'integer' },
  deadline: { format: 'date', nullable: true, type: 'string' },
  initialAmount: { ...plainDecimal, nullable: true },
  links: {
    items: {
      additionalProperties: false,
      properties: {
        accountId: { format: 'uuid', type: 'string' },
        share: shareJson,
      },
      required: ['accountId', 'share'],
      type: 'object',
    },
    maxItems: 20,
    type: 'array',
  },
  mode: { enum: ['free', 'linked'], type: 'string' },
  name: { maxLength: 120, minLength: 1, type: 'string' },
  target: plainDecimal,
};
const detailsRequired = [
  'currencyCode',
  'currencyMinorUnitScale',
  'links',
  'mode',
  'name',
  'target',
];
const conversionJson: SchemaObject = {
  description:
    'Presentation-only conversion to the goal currency (INV-047). Unavailable without a valid manual quote: never zero.',
  properties: {
    amount: { ...money, nullable: true },
    effectiveAt: { format: 'date-time', nullable: true, type: 'string' },
    inverted: { nullable: true, type: 'boolean' },
    quoteId: { format: 'uuid', nullable: true, type: 'string' },
    rate: { ...plainDecimal, nullable: true },
    source: { nullable: true, type: 'string' },
    status: {
      enum: ['same-currency', 'available', 'unavailable'],
      type: 'string',
    },
  },
  required: [
    'amount',
    'effectiveAt',
    'inverted',
    'quoteId',
    'rate',
    'source',
    'status',
  ],
  type: 'object',
};
const linkJson: SchemaObject = {
  properties: {
    accountId: { format: 'uuid', type: 'string' },
    accountName: { nullable: true, type: 'string' },
    belowDeclaredShares: { type: 'boolean' },
    conversion: conversionJson,
    counted: money,
    excluded: { type: 'boolean' },
    share: {
      properties: {
        amount: { ...money, nullable: true },
        kind: { enum: ['full', 'amount'], type: 'string' },
      },
      required: ['amount', 'kind'],
      type: 'object',
    },
  },
  required: [
    'accountId',
    'accountName',
    'belowDeclaredShares',
    'conversion',
    'counted',
    'excluded',
    'share',
  ],
  type: 'object',
};
const goalProperties: Record<string, SchemaObject> = {
  createdAt: { format: 'date-time', type: 'string' },
  deadline: { format: 'date', nullable: true, type: 'string' },
  id: { format: 'uuid', type: 'string' },
  initialAmount: money,
  lifecycle: { enum: ['active', 'paused', 'archived'], type: 'string' },
  links: { items: linkJson, type: 'array' },
  mode: { enum: ['free', 'linked'], type: 'string' },
  name: { type: 'string' },
  progress: {
    properties: {
      accumulated: { ...money, nullable: true },
      percent: { nullable: true, pattern: '^\\d+\\.\\d{2}$', type: 'string' },
      remaining: { ...money, nullable: true },
      status: {
        enum: [
          'in-progress',
          'completed',
          'overdue',
          'indeterminate',
          'paused',
          'archived',
        ],
        type: 'string',
      },
    },
    required: ['accumulated', 'percent', 'remaining', 'status'],
    type: 'object',
  },
  target: money,
  updatedAt: { format: 'date-time', type: 'string' },
  version: { minimum: 1, type: 'integer' },
};
const goalSchema: SchemaObject = {
  description:
    'A goal declared by the holder. It organizes progress only and never moves money nor changes balances or net worth.',
  properties: goalProperties,
  required: Object.keys(goalProperties),
  type: 'object',
};

type MoneyResponse = Readonly<{ amount: string; currencyCode: string }>;
type ConversionResponse = Readonly<{
  status: GoalConversion['status'];
  amount: MoneyResponse | null;
  effectiveAt: string | null;
  inverted: boolean | null;
  quoteId: string | null;
  rate: string | null;
  source: string | null;
}>;

export type GoalResponse = Readonly<{
  id: string;
  name: string;
  target: MoneyResponse;
  initialAmount: MoneyResponse;
  deadline: string | null;
  mode: string;
  lifecycle: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  links: readonly Readonly<{
    accountId: string;
    accountName: string | null;
    share: Readonly<{ kind: string; amount: MoneyResponse | null }>;
    counted: MoneyResponse;
    belowDeclaredShares: boolean;
    excluded: boolean;
    conversion: ConversionResponse;
  }>[];
  progress: Readonly<{
    accumulated: MoneyResponse | null;
    remaining: MoneyResponse | null;
    percent: string | null;
    status: string;
  }>;
}>;

@Controller('goals')
@ApiTags('goals')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Bearer token missing or invalid' })
@UseGuards(BearerAuthGuard)
export class GoalController {
  public constructor(
    @Inject(CreateGoalUseCase) private readonly createGoal: CreateGoalUseCase,
    @Inject(ListGoalsUseCase) private readonly listGoals: ListGoalsUseCase,
    @Inject(GetGoalUseCase) private readonly getGoal: GetGoalUseCase,
    @Inject(UpdateGoalUseCase) private readonly updateGoal: UpdateGoalUseCase,
    @Inject(ChangeGoalLifecycleUseCase)
    private readonly changeLifecycle: ChangeGoalLifecycleUseCase,
    @Inject(UnlinkGoalAccountUseCase)
    private readonly unlinkAccount: UnlinkGoalAccountUseCase,
    @Inject(GetAccountGoalImpactUseCase)
    private readonly accountImpact: GetAccountGoalImpactUseCase,
    @Inject(AuthenticatedActorContext)
    private readonly actors: AuthenticatedActorContext,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Declare a goal; no transaction is recorded' })
  @ApiHeader(idempotencyKeyHeader)
  @ApiBody({
    schema: {
      additionalProperties: false,
      properties: detailsProperties,
      required: detailsRequired,
      type: 'object',
    },
  })
  @ApiCreatedResponse({ schema: goalSchema })
  @ApiBadRequestResponse({ description: 'Invalid goal or idempotency key' })
  @ApiNotFoundResponse({ description: 'Owned available account not found' })
  @ApiConflictResponse({
    description: 'Idempotency key reused with a different payload',
  })
  @ApiUnprocessableEntityResponse({
    description: 'Account shares exceed the balance or conflict',
  })
  public async create(
    @Req() request: FastifyRequest,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body(new ZodValidationPipe(detailsSchema)) body: DetailsRequest,
  ): Promise<GoalResponse> {
    const key = parseIdempotencyKeyHeader(idempotencyKey);
    try {
      return mapGoal(
        await this.createGoal.execute({
          ...details(body),
          actorId: this.actorId(request),
          idempotencyKey: key,
        }),
      );
    } catch (error) {
      throw mapError(error);
    }
  }

  @Get()
  @ApiOperation({ summary: 'List owned goals with their progress' })
  @ApiOkResponse({ schema: { items: goalSchema, type: 'array' } })
  public async list(
    @Req() request: FastifyRequest,
  ): Promise<readonly GoalResponse[]> {
    return (await this.listGoals.execute(this.actorId(request))).map(mapGoal);
  }

  @Get('account-impact/:accountId')
  @ApiOperation({
    summary:
      'List the goals that use an account, before archiving or trashing it',
  })
  @ApiParam({ format: 'uuid', name: 'accountId', type: 'string' })
  @ApiOkResponse({ schema: { items: goalSchema, type: 'array' } })
  @ApiNotFoundResponse({ description: 'Owned account not found' })
  public async impact(
    @Req() request: FastifyRequest,
    @Param('accountId', new ZodValidationPipe(idSchema)) accountId: string,
  ): Promise<readonly GoalResponse[]> {
    try {
      return (
        await this.accountImpact.execute({
          accountId,
          actorId: this.actorId(request),
        })
      ).map(mapGoal);
    } catch (error) {
      throw mapError(error);
    }
  }

  @Get(':goalId')
  @ApiOperation({ summary: 'Get a goal with its progress' })
  @ApiParam({ format: 'uuid', name: 'goalId', type: 'string' })
  @ApiOkResponse({ schema: goalSchema })
  @ApiNotFoundResponse({ description: 'Owned goal not found' })
  public async get(
    @Req() request: FastifyRequest,
    @Param('goalId', new ZodValidationPipe(idSchema)) goalId: string,
  ): Promise<GoalResponse> {
    try {
      return mapGoal(
        await this.getGoal.execute({ actorId: this.actorId(request), goalId }),
      );
    } catch (error) {
      throw mapError(error);
    }
  }

  @Put(':goalId')
  @ApiOperation({ summary: 'Replace the details of a goal' })
  @ApiParam({ format: 'uuid', name: 'goalId', type: 'string' })
  @ApiBody({
    schema: {
      additionalProperties: false,
      properties: {
        ...detailsProperties,
        expectedVersion: { minimum: 1, type: 'integer' },
      },
      required: [...detailsRequired, 'expectedVersion'],
      type: 'object',
    },
  })
  @ApiOkResponse({ schema: goalSchema })
  @ApiBadRequestResponse({ description: 'Invalid goal' })
  @ApiNotFoundResponse({ description: 'Owned goal or account not found' })
  @ApiConflictResponse({ description: 'The goal version changed' })
  @ApiUnprocessableEntityResponse({
    description: 'Archived goal, or shares exceed the balance or conflict',
  })
  public async update(
    @Req() request: FastifyRequest,
    @Param('goalId', new ZodValidationPipe(idSchema)) goalId: string,
    @Body(new ZodValidationPipe(updateSchema)) body: UpdateRequest,
  ): Promise<GoalResponse> {
    try {
      return mapGoal(
        await this.updateGoal.execute({
          ...details(body),
          actorId: this.actorId(request),
          expectedVersion: body.expectedVersion,
          goalId,
        }),
      );
    } catch (error) {
      throw mapError(error);
    }
  }

  @Post(':goalId/lifecycle')
  @HttpCode(200)
  @ApiOperation({ summary: 'Pause, resume, archive or unarchive a goal' })
  @ApiParam({ format: 'uuid', name: 'goalId', type: 'string' })
  @ApiBody({
    schema: {
      additionalProperties: false,
      properties: {
        action: {
          enum: ['pause', 'resume', 'archive', 'unarchive'],
          type: 'string',
        },
        expectedVersion: { minimum: 1, type: 'integer' },
      },
      required: ['action', 'expectedVersion'],
      type: 'object',
    },
  })
  @ApiOkResponse({ schema: goalSchema })
  @ApiNotFoundResponse({ description: 'Owned goal or account not found' })
  @ApiConflictResponse({ description: 'The goal version changed' })
  @ApiUnprocessableEntityResponse({
    description: 'Transition not allowed, or shares no longer fit',
  })
  public async lifecycle(
    @Req() request: FastifyRequest,
    @Param('goalId', new ZodValidationPipe(idSchema)) goalId: string,
    @Body(new ZodValidationPipe(lifecycleSchema)) body: LifecycleRequest,
  ): Promise<GoalResponse> {
    try {
      return mapGoal(
        await this.changeLifecycle.execute({
          action: body.action,
          actorId: this.actorId(request),
          expectedVersion: body.expectedVersion,
          goalId,
        }),
      );
    } catch (error) {
      throw mapError(error);
    }
  }

  @Post(':goalId/unlink-account')
  @HttpCode(200)
  @ApiOperation({ summary: 'Remove an account from a goal' })
  @ApiParam({ format: 'uuid', name: 'goalId', type: 'string' })
  @ApiBody({
    schema: {
      additionalProperties: false,
      properties: {
        accountId: { format: 'uuid', type: 'string' },
        expectedVersion: { minimum: 1, type: 'integer' },
      },
      required: ['accountId', 'expectedVersion'],
      type: 'object',
    },
  })
  @ApiOkResponse({ schema: goalSchema })
  @ApiBadRequestResponse({ description: 'The account is not in the goal' })
  @ApiNotFoundResponse({ description: 'Owned goal not found' })
  @ApiConflictResponse({ description: 'The goal version changed' })
  @ApiUnprocessableEntityResponse({ description: 'Archived goal' })
  public async unlink(
    @Req() request: FastifyRequest,
    @Param('goalId', new ZodValidationPipe(idSchema)) goalId: string,
    @Body(new ZodValidationPipe(unlinkSchema)) body: UnlinkRequest,
  ): Promise<GoalResponse> {
    try {
      return mapGoal(
        await this.unlinkAccount.execute({
          accountId: body.accountId,
          actorId: this.actorId(request),
          expectedVersion: body.expectedVersion,
          goalId,
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

function details(body: DetailsRequest): GoalDetailsInput {
  return {
    currencyCode: body.currencyCode,
    currencyMinorUnitScale: body.currencyMinorUnitScale,
    deadline: body.deadline ?? null,
    initialAmount: body.initialAmount ?? null,
    links: body.links,
    mode: body.mode,
    name: body.name,
    target: body.target,
  };
}

function moneyOf(value: Money): MoneyResponse {
  return { amount: value.toDecimal(), currencyCode: value.currency.code };
}

function conversionOf(conversion: GoalConversion): ConversionResponse {
  if (conversion.status !== 'available') {
    return {
      amount: null,
      effectiveAt: null,
      inverted: null,
      quoteId: null,
      rate: null,
      source: null,
      status: conversion.status,
    };
  }
  return {
    amount: moneyOf(conversion.amount),
    effectiveAt: conversion.effectiveAt.toISOString(),
    inverted: conversion.inverted,
    quoteId: conversion.quoteId,
    rate: conversion.rate,
    source: conversion.source,
    status: 'available',
  };
}

export function mapGoal(view: GoalView): GoalResponse {
  const snapshot = view.goal.toSnapshot();
  const { progress } = view;
  return {
    createdAt: snapshot.createdAt.toISOString(),
    deadline: snapshot.deadline,
    id: snapshot.id,
    initialAmount: moneyOf(view.goal.initialAmount),
    lifecycle: snapshot.lifecycle,
    links: progress.lines.map((line) => ({
      accountId: line.accountId,
      accountName:
        view.accounts.find((account) => account.id === line.accountId)?.name ??
        null,
      belowDeclaredShares: line.belowDeclaredShares,
      conversion: conversionOf(line.conversion),
      counted: moneyOf(line.counted),
      excluded: line.excluded,
      share:
        line.share.kind === 'full'
          ? { amount: null, kind: 'full' }
          : { amount: moneyOf(line.share.amount), kind: 'amount' },
    })),
    mode: snapshot.mode,
    name: snapshot.name,
    progress: {
      accumulated:
        progress.accumulated === null ? null : moneyOf(progress.accumulated),
      percent: progress.percent,
      remaining:
        progress.remaining === null ? null : moneyOf(progress.remaining),
      status: progress.status,
    },
    target: moneyOf(view.goal.target),
    updatedAt: snapshot.updatedAt.toISOString(),
    version: snapshot.version,
  };
}

function mapError(error: unknown): Error {
  const idempotencyError = mapIdempotencyError(error);
  if (idempotencyError !== undefined) return idempotencyError;
  if (error instanceof GoalNotFoundError) {
    return new NotFoundException('Goal not found.');
  }
  if (error instanceof GoalAccountUnavailableError) {
    return new NotFoundException('Account not found.');
  }
  if (error instanceof GoalVersionConflictError) {
    return new ConflictException('The goal was changed by another request.');
  }
  if (
    error instanceof GoalShareExceedsBalanceError ||
    error instanceof GoalShareConflictError ||
    error instanceof GoalShareCurrencyError ||
    error instanceof GoalLifecycleError
  ) {
    return new UnprocessableEntityException(error.message);
  }
  if (
    error instanceof InvalidGoalError ||
    error instanceof InvalidCurrencyError ||
    error instanceof InvalidMoneyAmountError ||
    error instanceof InvalidCivilDateError
  ) {
    return new BadRequestException('Invalid goal request.');
  }
  return error instanceof Error ? error : new Error('Unknown goal error.');
}
