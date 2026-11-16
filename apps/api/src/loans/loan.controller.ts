import {
  CreateLoanUseCase,
  GetLoanUseCase,
  ListLoansUseCase,
  LoanCounterpartyUnavailableError,
  LoanEventInFutureError,
  LoanNotFoundError,
  RecordLoanEventUseCase,
  RenegotiateLoanUseCase,
  type LoanTermsInput,
  type LoanView,
} from '@seshat/application';
import {
  InvalidCivilDateError,
  InvalidCurrencyError,
  InvalidInterestRateError,
  InvalidLoanError,
  InvalidLoanEventError,
  InvalidLoanScheduleError,
  InvalidMoneyAmountError,
  LoanClosedError,
  LoanExcessBeyondContractError,
  LoanPaymentExcessUnclassifiedError,
  LoanPrepaymentMismatchError,
  Money,
  type LoanEvent,
} from '@seshat/domain';
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
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
const PERCENT = /^\d{1,3}(?:\.\d{1,6})?$/u;
const loanIdSchema = z.uuid();
const amountSchema = z.string().max(1002).regex(DECIMAL);
const component = z.enum(['fee', 'interest', 'principal']);
const orderSchema = z.array(component).length(3).nullable().optional();
const termsSchema = z.object({
  allocationOrder: orderSchema,
  businessDayRule: z.enum(['next-business-day', 'none']),
  contractedOn: z.iso.date(),
  count: z.number().int().min(1).max(420),
  currencyCode: z.string().regex(/^[A-Z]{3}$/u),
  currencyMinorUnitScale: z.number().int().min(0).max(18),
  declaredAmounts: z.array(amountSchema).max(420).nullable().optional(),
  description: z.string().trim().min(1).max(500),
  firstDueOn: z.iso.date(),
  lateFeePercent: z.string().max(11).regex(PERCENT).nullable().optional(),
  principal: amountSchema,
  profile: z.enum(['constant', 'decreasing', 'declared']),
  rate: z
    .object({
      method: z.enum(['simple', 'compound']),
      percentPerPeriod: z.string().max(11).regex(PERCENT),
      periodicity: z.enum(['monthly']),
    })
    .nullable()
    .optional(),
});
const createSchema = termsSchema.extend({
  counterpartyId: z.uuid().nullable().optional(),
  direction: z.enum(['payable', 'receivable']),
});
const eventSchema = z.discriminatedUnion('kind', [
  z.object({
    allocationOrder: orderSchema,
    amount: amountSchema,
    declaredFee: amountSchema.nullable().optional(),
    excess: z
      .enum(['extra-amortization', 'receivable-credit'])
      .nullable()
      .optional(),
    kind: z.literal('payment'),
    occurredOn: z.iso.date(),
  }),
  z.object({
    amount: amountSchema,
    discount: amountSchema,
    kind: z.literal('prepayment'),
    occurredOn: z.iso.date(),
  }),
  z.object({
    kind: z.literal('reversal'),
    reason: z.string().trim().min(1).max(500),
    reversedEventId: z.uuid(),
  }),
]);
const renegotiationSchema = z.object({
  occurredOn: z.iso.date(),
  terms: termsSchema,
});

type CreateRequest = z.infer<typeof createSchema>;
type EventRequest = z.infer<typeof eventSchema>;
type RenegotiationRequest = z.infer<typeof renegotiationSchema>;

const decimal = { pattern: '^-?\\d+(?:\\.\\d+)?$', type: 'string' } as const;
const nullableDecimal = { ...decimal, nullable: true } as const;
const civilDate = { format: 'date', type: 'string' } as const;
const orderJson: SchemaObject = {
  items: { enum: ['fee', 'interest', 'principal'], type: 'string' },
  maxItems: 3,
  minItems: 3,
  type: 'array',
};
const rateJson: SchemaObject = {
  additionalProperties: false,
  nullable: true,
  properties: {
    method: { enum: ['simple', 'compound'], type: 'string' },
    percentPerPeriod: { pattern: '^\\d{1,3}(?:\\.\\d{1,6})?$', type: 'string' },
    periodicity: { enum: ['monthly'], type: 'string' },
  },
  required: ['method', 'percentPerPeriod', 'periodicity'],
  type: 'object',
};
const termsProperties: Record<string, SchemaObject> = {
  allocationOrder: { ...orderJson, nullable: true },
  businessDayRule: { enum: ['next-business-day', 'none'], type: 'string' },
  contractedOn: civilDate,
  count: { maximum: 420, minimum: 1, type: 'integer' },
  currencyCode: { pattern: '^[A-Z]{3}$', type: 'string' },
  currencyMinorUnitScale: { maximum: 18, minimum: 0, type: 'integer' },
  declaredAmounts: {
    items: { pattern: '^\\d+(?:\\.\\d+)?$', type: 'string' },
    nullable: true,
    type: 'array',
  },
  description: { maxLength: 500, minLength: 1, type: 'string' },
  firstDueOn: civilDate,
  lateFeePercent: {
    nullable: true,
    pattern: '^\\d{1,3}(?:\\.\\d{1,6})?$',
    type: 'string',
  },
  principal: { pattern: '^\\d+(?:\\.\\d+)?$', type: 'string' },
  profile: { enum: ['constant', 'decreasing', 'declared'], type: 'string' },
  rate: rateJson,
};
const termsRequired = [
  'businessDayRule',
  'contractedOn',
  'count',
  'currencyCode',
  'currencyMinorUnitScale',
  'description',
  'firstDueOn',
  'principal',
  'profile',
];
const installmentProperties: Record<string, SchemaObject> = {
  amount: decimal,
  declaredFee: nullableDecimal,
  dueOn: {
    ...civilDate,
    description: 'Effective due date; delay starts the next day.',
  },
  estimatedFee: nullableDecimal,
  interest: decimal,
  number: { maximum: 420, minimum: 1, type: 'integer' },
  paid: decimal,
  principal: decimal,
  remaining: decimal,
  scheduledDueOn: civilDate,
  situation: {
    enum: ['paid', 'prepaid', 'renegotiated', 'overdue', 'partial', 'open'],
    type: 'string',
  },
};
const eventProperties: Record<string, SchemaObject> = {
  allocationOrder: { ...orderJson, nullable: true },
  amount: nullableDecimal,
  declaredFee: nullableDecimal,
  discount: nullableDecimal,
  excess: {
    enum: ['extra-amortization', 'receivable-credit'],
    nullable: true,
    type: 'string',
  },
  id: { format: 'uuid', type: 'string' },
  kind: {
    enum: ['payment', 'prepayment', 'renegotiation', 'reversal'],
    type: 'string',
  },
  newLoanId: { format: 'uuid', nullable: true, type: 'string' },
  occurredOn: { ...civilDate, nullable: true },
  reason: { nullable: true, type: 'string' },
  recordedAt: { format: 'date-time', type: 'string' },
  reversed: { type: 'boolean' },
  reversedEventId: { format: 'uuid', nullable: true, type: 'string' },
};
const loanProperties: Record<string, SchemaObject> = {
  ...termsProperties,
  calculationVersion: { minimum: 1, type: 'integer' },
  counterpartyId: { format: 'uuid', nullable: true, type: 'string' },
  createdAt: { format: 'date-time', type: 'string' },
  credit: decimal,
  direction: { enum: ['payable', 'receivable'], type: 'string' },
  events: {
    items: {
      properties: eventProperties,
      required: Object.keys(eventProperties),
      type: 'object',
    },
    type: 'array',
  },
  id: { format: 'uuid', type: 'string' },
  installments: {
    items: {
      properties: installmentProperties,
      required: Object.keys(installmentProperties),
      type: 'object',
    },
    type: 'array',
  },
  interest: decimal,
  paidTotal: decimal,
  pending: {
    ...decimal,
    description:
      'Organizational outstanding balance (INV-048); negative when a declared credit exceeds it.',
  },
  renegotiatedFromId: { format: 'uuid', nullable: true, type: 'string' },
  status: { enum: ['active', 'settled', 'renegotiated'], type: 'string' },
  total: decimal,
};
const loanSchema: SchemaObject = {
  description:
    'A loan to pay or receive, declared by the holder. Seshat Finance never moves money for it.',
  properties: loanProperties,
  required: Object.keys(loanProperties),
  type: 'object',
};

@Controller('loans')
@ApiTags('loans')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Bearer token missing or invalid' })
@UseGuards(BearerAuthGuard)
export class LoanController {
  public constructor(
    @Inject(CreateLoanUseCase) private readonly createLoan: CreateLoanUseCase,
    @Inject(ListLoansUseCase) private readonly listLoans: ListLoansUseCase,
    @Inject(GetLoanUseCase) private readonly getLoan: GetLoanUseCase,
    @Inject(RecordLoanEventUseCase)
    private readonly recordEvent: RecordLoanEventUseCase,
    @Inject(RenegotiateLoanUseCase)
    private readonly renegotiate: RenegotiateLoanUseCase,
    @Inject(AuthenticatedActorContext)
    private readonly actors: AuthenticatedActorContext,
  ) {}

  @Post()
  @ApiOperation({
    summary: 'Record a loan already agreed outside Seshat Finance',
  })
  @ApiHeader(idempotencyKeyHeader)
  @ApiBody({
    schema: {
      additionalProperties: false,
      properties: {
        ...termsProperties,
        counterpartyId: { format: 'uuid', nullable: true, type: 'string' },
        direction: { enum: ['payable', 'receivable'], type: 'string' },
      },
      required: [...termsRequired, 'direction'],
      type: 'object',
    },
  })
  @ApiCreatedResponse({ schema: loanSchema })
  @ApiBadRequestResponse({ description: 'Invalid terms or idempotency key' })
  @ApiNotFoundResponse({ description: 'Owned active counterparty not found' })
  @ApiConflictResponse({
    description: 'Idempotency key reused with a different payload',
  })
  public async create(
    @Req() request: FastifyRequest,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body(new ZodValidationPipe(createSchema)) body: CreateRequest,
  ): Promise<LoanResponse> {
    const key = parseIdempotencyKeyHeader(idempotencyKey);
    try {
      return mapLoan(
        await this.createLoan.execute({
          ...terms(body),
          actorId: this.actorId(request),
          counterpartyId: body.counterpartyId ?? null,
          direction: body.direction,
          idempotencyKey: key,
        }),
      );
    } catch (error) {
      throw mapError(error);
    }
  }

  @Get()
  @ApiOperation({ summary: 'List owned loans with their pending balance' })
  @ApiOkResponse({ schema: { items: loanSchema, type: 'array' } })
  public async list(
    @Req() request: FastifyRequest,
  ): Promise<readonly LoanResponse[]> {
    return (await this.listLoans.execute(this.actorId(request))).map(mapLoan);
  }

  @Get(':loanId')
  @ApiOperation({ summary: 'Get a loan with its schedule and events' })
  @ApiParam({ format: 'uuid', name: 'loanId', type: 'string' })
  @ApiOkResponse({ schema: loanSchema })
  @ApiNotFoundResponse({ description: 'Owned loan not found' })
  public async get(
    @Req() request: FastifyRequest,
    @Param('loanId', new ZodValidationPipe(loanIdSchema)) loanId: string,
  ): Promise<LoanResponse> {
    try {
      return mapLoan(
        await this.getLoan.execute({ actorId: this.actorId(request), loanId }),
      );
    } catch (error) {
      throw mapError(error);
    }
  }

  @Post(':loanId/events')
  @ApiOperation({
    summary:
      'Declare a payment, prepayment or reversal already done outside Seshat Finance',
  })
  @ApiParam({ format: 'uuid', name: 'loanId', type: 'string' })
  @ApiHeader(idempotencyKeyHeader)
  @ApiBody({
    schema: {
      oneOf: [
        {
          additionalProperties: false,
          properties: {
            allocationOrder: { ...orderJson, nullable: true },
            amount: { pattern: '^\\d+(?:\\.\\d+)?$', type: 'string' },
            declaredFee: {
              nullable: true,
              pattern: '^\\d+(?:\\.\\d+)?$',
              type: 'string',
            },
            excess: {
              enum: ['extra-amortization', 'receivable-credit'],
              nullable: true,
              type: 'string',
            },
            kind: { enum: ['payment'], type: 'string' },
            occurredOn: civilDate,
          },
          required: ['amount', 'kind', 'occurredOn'],
          type: 'object',
        },
        {
          additionalProperties: false,
          properties: {
            amount: { pattern: '^\\d+(?:\\.\\d+)?$', type: 'string' },
            discount: { pattern: '^\\d+(?:\\.\\d+)?$', type: 'string' },
            kind: { enum: ['prepayment'], type: 'string' },
            occurredOn: civilDate,
          },
          required: ['amount', 'discount', 'kind', 'occurredOn'],
          type: 'object',
        },
        {
          additionalProperties: false,
          properties: {
            kind: { enum: ['reversal'], type: 'string' },
            reason: { maxLength: 500, minLength: 1, type: 'string' },
            reversedEventId: { format: 'uuid', type: 'string' },
          },
          required: ['kind', 'reason', 'reversedEventId'],
          type: 'object',
        },
      ],
    },
  })
  @ApiCreatedResponse({ schema: loanSchema })
  @ApiBadRequestResponse({ description: 'Invalid event or idempotency key' })
  @ApiNotFoundResponse({ description: 'Owned loan not found' })
  @ApiConflictResponse({
    description: 'Idempotency key reused with a different payload',
  })
  @ApiUnprocessableEntityResponse({
    description:
      'Unclassified excess, prepayment mismatch, closed loan or future date',
  })
  public async event(
    @Req() request: FastifyRequest,
    @Param('loanId', new ZodValidationPipe(loanIdSchema)) loanId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body(new ZodValidationPipe(eventSchema)) body: EventRequest,
  ): Promise<LoanResponse> {
    const key = parseIdempotencyKeyHeader(idempotencyKey);
    try {
      return mapLoan(
        await this.recordEvent.execute({
          actorId: this.actorId(request),
          event: body,
          idempotencyKey: key,
          loanId,
        }),
      );
    } catch (error) {
      throw mapError(error);
    }
  }

  @Post(':loanId/renegotiation')
  @ApiOperation({
    summary:
      'Register a renegotiation agreed outside Seshat Finance as a new linked loan',
  })
  @ApiParam({ format: 'uuid', name: 'loanId', type: 'string' })
  @ApiHeader(idempotencyKeyHeader)
  @ApiBody({
    schema: {
      additionalProperties: false,
      properties: {
        occurredOn: civilDate,
        terms: {
          additionalProperties: false,
          properties: termsProperties,
          required: termsRequired,
          type: 'object',
        },
      },
      required: ['occurredOn', 'terms'],
      type: 'object',
    },
  })
  @ApiCreatedResponse({ schema: loanSchema })
  @ApiBadRequestResponse({ description: 'Invalid terms or idempotency key' })
  @ApiNotFoundResponse({ description: 'Owned loan not found' })
  @ApiConflictResponse({
    description: 'Idempotency key reused with a different payload',
  })
  @ApiUnprocessableEntityResponse({
    description: 'The loan is already settled or renegotiated, or future date',
  })
  public async renegotiation(
    @Req() request: FastifyRequest,
    @Param('loanId', new ZodValidationPipe(loanIdSchema)) loanId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body(new ZodValidationPipe(renegotiationSchema))
    body: RenegotiationRequest,
  ): Promise<LoanResponse> {
    const key = parseIdempotencyKeyHeader(idempotencyKey);
    try {
      return mapLoan(
        await this.renegotiate.execute({
          actorId: this.actorId(request),
          idempotencyKey: key,
          loanId,
          occurredOn: body.occurredOn,
          terms: terms(body.terms),
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

function terms(body: z.infer<typeof termsSchema>): LoanTermsInput {
  return {
    allocationOrder: body.allocationOrder ?? null,
    businessDayRule: body.businessDayRule,
    contractedOn: body.contractedOn,
    count: body.count,
    currencyCode: body.currencyCode,
    currencyMinorUnitScale: body.currencyMinorUnitScale,
    declaredAmounts: body.declaredAmounts ?? null,
    description: body.description,
    firstDueOn: body.firstDueOn,
    lateFeePercent: body.lateFeePercent ?? null,
    principal: body.principal,
    profile: body.profile,
    rate: body.rate ?? null,
  };
}

type LoanResponse = Readonly<Record<string, unknown>>;

export function mapLoan(view: LoanView): LoanResponse {
  const value = view.loan.toSnapshot();
  const reversed = new Set(view.state.reversedEventIds);
  const principal = Money.restore(value.principal);
  const total = value.installments.reduce(
    (sum, item) => sum.add(Money.restore(item.amount)),
    Money.fromMinorUnits(0n, principal.currency),
  );
  return {
    allocationOrder: value.allocationOrder,
    businessDayRule: value.businessDayRule,
    calculationVersion: value.calculationVersion,
    contractedOn: value.contractedOn,
    count: value.count,
    counterpartyId: value.counterpartyId,
    createdAt: value.createdAt.toISOString(),
    credit: view.state.credit.toDecimal(),
    currencyCode: value.principal.currency.code,
    currencyMinorUnitScale: principal.currency.minorUnitScale,
    declaredAmounts: value.declaredAmounts,
    description: value.description,
    direction: value.direction,
    events: view.events.map((event) => mapEvent(event, reversed)),
    firstDueOn: value.firstDueOn,
    id: value.id,
    installments: view.state.installments.map((state, index) => {
      const item = value.installments[index];
      return {
        amount: state.amount.toDecimal(),
        declaredFee: state.declaredFee?.toDecimal() ?? null,
        dueOn: state.dueOn,
        estimatedFee: state.estimatedFee?.toDecimal() ?? null,
        interest: item?.interest.amount ?? '0',
        number: state.number,
        paid: state.paid.toDecimal(),
        principal: item?.principal.amount ?? '0',
        remaining: state.remaining.toDecimal(),
        scheduledDueOn: item?.scheduledDueOn ?? state.dueOn,
        situation: state.situation,
      };
    }),
    interest: total.subtract(principal).toDecimal(),
    lateFeePercent: value.lateFeePercent,
    paidTotal: view.state.paidTotal.toDecimal(),
    pending: view.state.pending.toDecimal(),
    principal: value.principal.amount,
    profile: value.profile,
    rate: value.rate,
    renegotiatedFromId: value.renegotiatedFromId,
    status: view.state.status,
    total: total.toDecimal(),
  };
}

function mapEvent(
  event: LoanEvent,
  reversed: ReadonlySet<string>,
): Record<string, unknown> {
  return {
    allocationOrder: event.kind === 'payment' ? event.allocationOrder : null,
    amount:
      event.kind === 'payment' || event.kind === 'prepayment'
        ? event.amount.amount
        : null,
    declaredFee:
      event.kind === 'payment' ? (event.declaredFee?.amount ?? null) : null,
    discount: event.kind === 'prepayment' ? event.discount.amount : null,
    excess: event.kind === 'payment' ? event.excess : null,
    id: event.id,
    kind: event.kind,
    newLoanId: event.kind === 'renegotiation' ? event.newLoanId : null,
    occurredOn: event.kind === 'reversal' ? null : event.occurredOn,
    reason: event.kind === 'reversal' ? event.reason : null,
    recordedAt: new Date(event.recordedAt).toISOString(),
    reversed: reversed.has(event.id),
    reversedEventId: event.kind === 'reversal' ? event.reversedEventId : null,
  };
}

function mapError(error: unknown): Error {
  const idempotencyError = mapIdempotencyError(error);
  if (idempotencyError !== undefined) return idempotencyError;
  if (error instanceof LoanNotFoundError) {
    return new NotFoundException('Loan not found.');
  }
  if (error instanceof LoanCounterpartyUnavailableError) {
    return new NotFoundException('Counterparty not found.');
  }
  if (
    error instanceof LoanPaymentExcessUnclassifiedError ||
    error instanceof LoanExcessBeyondContractError ||
    error instanceof LoanPrepaymentMismatchError ||
    error instanceof LoanClosedError ||
    error instanceof LoanEventInFutureError
  ) {
    return new UnprocessableEntityException(error.message);
  }
  if (
    error instanceof InvalidLoanError ||
    error instanceof InvalidLoanScheduleError ||
    error instanceof InvalidLoanEventError ||
    error instanceof InvalidInterestRateError ||
    error instanceof InvalidCurrencyError ||
    error instanceof InvalidMoneyAmountError ||
    error instanceof InvalidCivilDateError
  ) {
    return new BadRequestException('Invalid loan request.');
  }
  return error instanceof Error ? error : new Error('Unknown loan error.');
}
