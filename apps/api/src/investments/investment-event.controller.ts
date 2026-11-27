import {
  ChangeInvestmentEventLifecycleUseCase,
  InvestmentCustodyExceededError,
  InvestmentEventAccountUnavailableError,
  InvestmentEventCurrencyMismatchError,
  InvestmentEventNotFoundError,
  InvestmentEventVersionConflictError,
  InvestmentNotFoundError,
  InvestmentUnavailableForEventError,
  ListInvestmentEventsUseCase,
  RecordInvestmentEventUseCase,
} from '@seshat/application';
import {
  InvalidInvestmentEventError,
  InvalidMoneyAmountError,
  investmentEventKinds,
  investmentEventLifecycles,
  type InvestmentEvent,
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
const recordSchema = z.object({
  accountId: z.uuid().nullable().optional(),
  amount: z.string().max(40).regex(DECIMAL),
  kind: z.enum(investmentEventKinds),
  note: z.string().max(500).nullable().optional(),
  occurredAt: z.iso.datetime({ offset: true }),
  quantity: z.string().max(40).regex(DECIMAL).nullable().optional(),
  timeZone: z.string().min(1).max(64),
  unitPrice: z.string().max(40).regex(DECIMAL).nullable().optional(),
});
const lifecycleSchema = z.object({
  action: z.enum(['trash', 'restore']),
  expectedVersion: z.number().int().min(1),
});

type RecordRequest = z.infer<typeof recordSchema>;
type LifecycleRequest = z.infer<typeof lifecycleSchema>;

const decimalDoc: SchemaObject = {
  pattern: '^\\d+(?:\\.\\d+)?$',
  type: 'string',
};
const recordDoc: Record<string, SchemaObject> = {
  accountId: {
    description:
      'Owned active account in the investment currency. With an aporte or resgate it writes a linked account entry that is neither income nor expense; with an income it writes a linked income. Not allowed for fees and taxes.',
    format: 'uuid',
    nullable: true,
    type: 'string',
  },
  amount: {
    ...decimalDoc,
    description: 'Positive amount in the investment currency.',
  },
  kind: { enum: [...investmentEventKinds], type: 'string' },
  note: { maxLength: 500, nullable: true, type: 'string' },
  occurredAt: { format: 'date-time', type: 'string' },
  quantity: {
    ...decimalDoc,
    description:
      'Required for aportes and resgates of types with quantity, within the type scale; otherwise null.',
    nullable: true,
  },
  timeZone: { description: 'IANA time zone of the event.', type: 'string' },
  unitPrice: {
    ...decimalDoc,
    description: 'Optional unit price with up to 8 decimal places.',
    nullable: true,
  },
};
const eventProperties: Record<string, SchemaObject> = {
  ...recordDoc,
  createdAt: { format: 'date-time', type: 'string' },
  currencyCode: { pattern: '^[A-Z]{3}$', type: 'string' },
  currencyMinorUnitScale: { minimum: 0, type: 'integer' },
  id: { format: 'uuid', type: 'string' },
  investmentId: { format: 'uuid', type: 'string' },
  lifecycle: { enum: [...investmentEventLifecycles], type: 'string' },
  occurredOn: { format: 'date', type: 'string' },
  transactionId: {
    description: 'Linked account entry, if any.',
    format: 'uuid',
    nullable: true,
    type: 'string',
  },
  updatedAt: { format: 'date-time', type: 'string' },
  version: { minimum: 1, type: 'integer' },
};
const eventSchema: SchemaObject = {
  description:
    'A declared investment event. Seshat Finance only records it; nothing is executed at any broker or bank.',
  properties: eventProperties,
  required: Object.keys(eventProperties),
  type: 'object',
};

export type InvestmentEventResponse = Readonly<{
  id: string;
  investmentId: string;
  kind: string;
  amount: string;
  currencyCode: string;
  currencyMinorUnitScale: number;
  quantity: string | null;
  unitPrice: string | null;
  occurredAt: string;
  timeZone: string;
  occurredOn: string;
  accountId: string | null;
  transactionId: string | null;
  note: string | null;
  lifecycle: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}>;

@Controller()
@ApiTags('investments')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Bearer token missing or invalid' })
@UseGuards(BearerAuthGuard)
export class InvestmentEventController {
  public constructor(
    @Inject(RecordInvestmentEventUseCase)
    private readonly recordEvent: RecordInvestmentEventUseCase,
    @Inject(ListInvestmentEventsUseCase)
    private readonly listEvents: ListInvestmentEventsUseCase,
    @Inject(ChangeInvestmentEventLifecycleUseCase)
    private readonly changeLifecycle: ChangeInvestmentEventLifecycleUseCase,
    @Inject(AuthenticatedActorContext)
    private readonly actors: AuthenticatedActorContext,
  ) {}

  @Post('investments/:investmentId/events')
  @ApiOperation({
    summary:
      'Record an aporte, resgate, income, fee or tax of a manual investment',
  })
  @ApiHeader(idempotencyKeyHeader)
  @ApiParam({ format: 'uuid', name: 'investmentId', type: 'string' })
  @ApiBody({
    schema: {
      additionalProperties: false,
      properties: recordDoc,
      required: ['amount', 'kind', 'occurredAt', 'timeZone'],
      type: 'object',
    },
  })
  @ApiCreatedResponse({ schema: eventSchema })
  @ApiBadRequestResponse({ description: 'Invalid event or idempotency key' })
  @ApiNotFoundResponse({ description: 'Owned investment not found' })
  @ApiConflictResponse({ description: 'Idempotency key reused' })
  @ApiUnprocessableEntityResponse({
    description:
      'Inactive investment, unusable account, other currency or custody exceeded',
  })
  public async record(
    @Req() request: FastifyRequest,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Param('investmentId', new ZodValidationPipe(idSchema))
    investmentId: string,
    @Body(new ZodValidationPipe(recordSchema)) body: RecordRequest,
  ): Promise<InvestmentEventResponse> {
    const key = parseIdempotencyKeyHeader(idempotencyKey);
    try {
      return mapInvestmentEvent(
        await this.recordEvent.execute({
          ...body,
          actorId: this.actorId(request),
          idempotencyKey: key,
          investmentId,
          occurredAt: new Date(body.occurredAt),
        }),
      );
    } catch (error) {
      throw mapError(error);
    }
  }

  @Get('investments/:investmentId/events')
  @ApiOperation({ summary: 'List the events of an owned investment' })
  @ApiParam({ format: 'uuid', name: 'investmentId', type: 'string' })
  @ApiOkResponse({ schema: { items: eventSchema, type: 'array' } })
  @ApiNotFoundResponse({ description: 'Owned investment not found' })
  public async list(
    @Req() request: FastifyRequest,
    @Param('investmentId', new ZodValidationPipe(idSchema))
    investmentId: string,
  ): Promise<readonly InvestmentEventResponse[]> {
    try {
      return (
        await this.listEvents.execute({
          actorId: this.actorId(request),
          investmentId,
        })
      ).map(mapInvestmentEvent);
    } catch (error) {
      throw mapError(error);
    }
  }

  @Post('investment-events/:eventId/lifecycle')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Move an event and its linked account entry to the trash or back',
  })
  @ApiParam({ format: 'uuid', name: 'eventId', type: 'string' })
  @ApiBody({
    schema: {
      additionalProperties: false,
      properties: {
        action: { enum: ['trash', 'restore'], type: 'string' },
        expectedVersion: { minimum: 1, type: 'integer' },
      },
      required: ['action', 'expectedVersion'],
      type: 'object',
    },
  })
  @ApiOkResponse({ schema: eventSchema })
  @ApiNotFoundResponse({ description: 'Owned investment event not found' })
  @ApiConflictResponse({ description: 'Event changed by another request' })
  @ApiUnprocessableEntityResponse({
    description: 'Transition not allowed or custody would become negative',
  })
  public async lifecycle(
    @Req() request: FastifyRequest,
    @Param('eventId', new ZodValidationPipe(idSchema)) eventId: string,
    @Body(new ZodValidationPipe(lifecycleSchema)) body: LifecycleRequest,
  ): Promise<InvestmentEventResponse> {
    try {
      return mapInvestmentEvent(
        await this.changeLifecycle.execute({
          ...body,
          actorId: this.actorId(request),
          eventId,
        }),
      );
    } catch (error) {
      if (error instanceof InvalidInvestmentEventError) {
        throw new UnprocessableEntityException(error.message);
      }
      throw mapError(error);
    }
  }

  private actorId(request: FastifyRequest): string {
    const actor = this.actors.get(request);
    if (actor === undefined) throw new UnauthorizedException();
    return actor.id;
  }
}

export function mapInvestmentEvent(
  event: InvestmentEvent,
): InvestmentEventResponse {
  const snapshot = event.toSnapshot();
  return {
    accountId: snapshot.accountId,
    amount: snapshot.amount.amount,
    createdAt: snapshot.createdAt.toISOString(),
    currencyCode: snapshot.amount.currency.code,
    currencyMinorUnitScale: snapshot.amount.currency.minorUnitScale,
    id: snapshot.id,
    investmentId: snapshot.investmentId,
    kind: snapshot.kind,
    lifecycle: snapshot.lifecycle,
    note: snapshot.note,
    occurredAt: snapshot.occurredAt.toISOString(),
    occurredOn: snapshot.occurredOn,
    quantity: snapshot.quantity,
    timeZone: snapshot.timeZone,
    transactionId: snapshot.transactionId,
    unitPrice: snapshot.unitPrice,
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
  if (error instanceof InvestmentEventNotFoundError) {
    return new NotFoundException('Investment event not found.');
  }
  if (error instanceof InvestmentEventVersionConflictError) {
    return new ConflictException(error.message);
  }
  if (
    error instanceof InvestmentUnavailableForEventError ||
    error instanceof InvestmentEventAccountUnavailableError ||
    error instanceof InvestmentEventCurrencyMismatchError ||
    error instanceof InvestmentCustodyExceededError
  ) {
    return new UnprocessableEntityException(error.message);
  }
  if (
    error instanceof InvalidInvestmentEventError ||
    error instanceof InvalidMoneyAmountError
  ) {
    return new BadRequestException(error.message);
  }
  return error instanceof Error
    ? error
    : new Error('Unknown investment event error.');
}
