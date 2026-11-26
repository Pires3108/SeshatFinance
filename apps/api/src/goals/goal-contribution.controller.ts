import {
  ContributionGoalUnavailableError,
  ContributionSourceNotFoundError,
  ContributionSourceUnavailableError,
  ContributionVersionConflictError,
  DistributeContributionUseCase,
  GetContributionUseCase,
  ListContributionSourcesUseCase,
  type ContributionSourceView,
  type ContributionView,
} from '@seshat/application';
import {
  ContributionExceedsSourceError,
  InvalidContributionError,
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
  Inject,
  NotFoundException,
  Param,
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

const idSchema = z.uuid();
const distributeSchema = z.object({
  expectedVersion: z.number().int().min(0),
  lines: z
    .array(
      z.object({
        amount: z
          .string()
          .max(1002)
          .regex(/^\d+(?:\.\d+)?$/u),
        goalId: z.uuid(),
      }),
    )
    .max(20),
});

type DistributeRequest = z.infer<typeof distributeSchema>;

const money: SchemaObject = {
  properties: {
    amount: { pattern: '^-?\\d+(?:\\.\\d+)?$', type: 'string' },
    currencyCode: { pattern: '^[A-Z]{3}$', type: 'string' },
  },
  required: ['amount', 'currencyCode'],
  type: 'object',
};
const sourceProperties: Record<string, SchemaObject> = {
  accountId: { format: 'uuid', type: 'string' },
  amount: money,
  description: { nullable: true, type: 'string' },
  id: { format: 'uuid', type: 'string' },
  kind: { enum: ['income', 'transfer-in'], type: 'string' },
  lifecycle: { enum: ['active', 'archived', 'trashed'], type: 'string' },
  occurredAt: { format: 'date-time', type: 'string' },
};
const sourceSchema: SchemaObject = {
  properties: sourceProperties,
  required: Object.keys(sourceProperties),
  type: 'object',
};
const contributionProperties: Record<string, SchemaObject> = {
  allocated: money,
  lines: {
    items: {
      properties: { amount: money, goalId: { format: 'uuid', type: 'string' } },
      required: ['amount', 'goalId'],
      type: 'object',
    },
    type: 'array',
  },
  remaining: money,
  source: sourceSchema,
  version: { minimum: 0, type: 'integer' },
};
const contributionSchema: SchemaObject = {
  description:
    'How one eligible entry is split between goals. The entry keeps its full value in the balance; the lines never exceed it.',
  properties: contributionProperties,
  required: Object.keys(contributionProperties),
  type: 'object',
};
const summaryProperties: Record<string, SchemaObject> = {
  ...sourceProperties,
  allocated: { ...money, nullable: true },
  version: { minimum: 0, type: 'integer' },
};

type MoneyResponse = Readonly<{ amount: string; currencyCode: string }>;

export type ContributionSourceResponse = Readonly<{
  id: string;
  accountId: string;
  amount: MoneyResponse;
  kind: string;
  lifecycle: string;
  occurredAt: string;
  description: string | null;
}>;

export type ContributionResponse = Readonly<{
  source: ContributionSourceResponse;
  lines: readonly Readonly<{ goalId: string; amount: MoneyResponse }>[];
  allocated: MoneyResponse;
  remaining: MoneyResponse;
  version: number;
}>;

export type ContributionSourceSummaryResponse = ContributionSourceResponse &
  Readonly<{ allocated: MoneyResponse | null; version: number }>;

@Controller('goal-contributions')
@ApiTags('goals')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Bearer token missing or invalid' })
@UseGuards(BearerAuthGuard)
export class GoalContributionController {
  public constructor(
    @Inject(DistributeContributionUseCase)
    private readonly distribute: DistributeContributionUseCase,
    @Inject(GetContributionUseCase)
    private readonly getContribution: GetContributionUseCase,
    @Inject(ListContributionSourcesUseCase)
    private readonly listSources: ListContributionSourcesUseCase,
    @Inject(AuthenticatedActorContext)
    private readonly actors: AuthenticatedActorContext,
  ) {}

  @Get('sources')
  @ApiOperation({
    summary:
      'Recent eligible entries (incomes and incoming transfers) with what is already distributed',
  })
  @ApiOkResponse({
    schema: {
      items: {
        properties: summaryProperties,
        required: Object.keys(summaryProperties),
        type: 'object',
      },
      type: 'array',
    },
  })
  public async sources(
    @Req() request: FastifyRequest,
  ): Promise<readonly ContributionSourceSummaryResponse[]> {
    const sources = await this.listSources.execute(this.actorId(request));
    return sources.map((source) => ({
      ...mapSource(source),
      allocated: source.allocated === null ? null : mapMoney(source.allocated),
      version: source.version,
    }));
  }

  @Get(':transactionId')
  @ApiOperation({ summary: 'Get how an eligible entry is split between goals' })
  @ApiParam({ format: 'uuid', name: 'transactionId', type: 'string' })
  @ApiOkResponse({ schema: contributionSchema })
  @ApiNotFoundResponse({ description: 'Owned eligible entry not found' })
  public async get(
    @Req() request: FastifyRequest,
    @Param('transactionId', new ZodValidationPipe(idSchema))
    transactionId: string,
  ): Promise<ContributionResponse> {
    try {
      return mapView(
        await this.getContribution.execute({
          actorId: this.actorId(request),
          sourceTransactionId: transactionId,
        }),
      );
    } catch (error) {
      throw mapError(error);
    }
  }

  @Put(':transactionId')
  @ApiOperation({
    summary:
      'Replace how an eligible entry is split between goals (empty lines remove it); the entry is never changed',
  })
  @ApiParam({ format: 'uuid', name: 'transactionId', type: 'string' })
  @ApiHeader(idempotencyKeyHeader)
  @ApiBody({
    schema: {
      additionalProperties: false,
      properties: {
        expectedVersion: {
          description: '0 when the entry was never distributed',
          minimum: 0,
          type: 'integer',
        },
        lines: {
          items: {
            additionalProperties: false,
            properties: {
              amount: { pattern: '^\\d+(?:\\.\\d+)?$', type: 'string' },
              goalId: { format: 'uuid', type: 'string' },
            },
            required: ['amount', 'goalId'],
            type: 'object',
          },
          maxItems: 20,
          type: 'array',
        },
      },
      required: ['expectedVersion', 'lines'],
      type: 'object',
    },
  })
  @ApiOkResponse({ schema: contributionSchema })
  @ApiBadRequestResponse({ description: 'Invalid lines or idempotency key' })
  @ApiNotFoundResponse({ description: 'Owned eligible entry not found' })
  @ApiConflictResponse({
    description:
      'Distribution changed by another request, or idempotency key reused with a different payload',
  })
  @ApiUnprocessableEntityResponse({
    description:
      'Lines exceed the entry, the entry is trashed or a goal is unavailable',
  })
  public async put(
    @Req() request: FastifyRequest,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Param('transactionId', new ZodValidationPipe(idSchema))
    transactionId: string,
    @Body(new ZodValidationPipe(distributeSchema)) body: DistributeRequest,
  ): Promise<ContributionResponse> {
    const key = parseIdempotencyKeyHeader(idempotencyKey);
    try {
      return mapView(
        await this.distribute.execute({
          actorId: this.actorId(request),
          expectedVersion: body.expectedVersion,
          idempotencyKey: key,
          lines: body.lines,
          sourceTransactionId: transactionId,
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

function mapMoney(value: Money): MoneyResponse {
  return { amount: value.toDecimal(), currencyCode: value.currency.code };
}

function mapSource(source: ContributionSourceView): ContributionSourceResponse {
  return {
    accountId: source.accountId,
    amount: mapMoney(source.amount),
    description: source.description,
    id: source.id,
    kind: source.kind,
    lifecycle: source.lifecycle,
    occurredAt: source.occurredAt.toISOString(),
  };
}

function mapView(view: ContributionView): ContributionResponse {
  return {
    allocated: mapMoney(view.allocated),
    lines: view.lines.map((line) => ({
      amount: mapMoney(line.amount),
      goalId: line.goalId,
    })),
    remaining: mapMoney(view.remaining),
    source: mapSource(view.source),
    version: view.version,
  };
}

function mapError(error: unknown): Error {
  const idempotencyError = mapIdempotencyError(error);
  if (idempotencyError !== undefined) return idempotencyError;
  if (error instanceof ContributionSourceNotFoundError) {
    return new NotFoundException('Entry not found.');
  }
  if (error instanceof ContributionVersionConflictError) {
    return new ConflictException(
      'The distribution was changed by another request.',
    );
  }
  if (
    error instanceof ContributionExceedsSourceError ||
    error instanceof ContributionSourceUnavailableError ||
    error instanceof ContributionGoalUnavailableError
  ) {
    return new UnprocessableEntityException(error.message);
  }
  if (
    error instanceof InvalidContributionError ||
    error instanceof InvalidMoneyAmountError
  ) {
    return new BadRequestException('Invalid contribution request.');
  }
  return error instanceof Error
    ? error
    : new Error('Unknown contribution error.');
}
