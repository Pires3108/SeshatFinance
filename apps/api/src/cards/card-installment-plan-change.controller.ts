import {
  CardInstallmentInvoiceClosedError,
  CardInstallmentPlanNotFoundError,
  CardInstallmentSettledAboveObligationError,
  CardPurchaseNotFoundError,
  CreditCardNotFoundError,
  GetCardInstallmentPlanChainUseCase,
  PrepayCardInstallmentPlanUseCase,
  RenegotiateCardInstallmentPlanUseCase,
  ReverseCardInstallmentPlanChangeUseCase,
  type CardPlanChainView,
} from '@seshat/application';
import {
  CardPlanClosedError,
  CardPlanPrepaymentMismatchError,
  CardPlanWithoutFutureInstallmentsError,
  InvalidCardPlanChangeError,
  InvalidInstallmentPlanError,
  InvalidInterestRateError,
  InvalidMoneyAmountError,
  type CardPlanChange,
} from '@seshat/domain';
import {
  BadRequestException,
  Body,
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
import {
  installmentPlanSchema,
  mapPlan,
} from './card-installment-plan.controller.js';

const uuidSchema = z.uuid();
const amount = z
  .string()
  .max(1002)
  .regex(/^\d+(?:\.\d+)?$/u);
const prepaymentSchema = z.object({ amount, discount: amount });
const renegotiationSchema = z.object({
  count: z.number().int().min(1).max(420),
  principal: amount,
  rate: z
    .object({
      method: z.enum(['simple', 'compound']),
      percentPerPeriod: z
        .string()
        .max(11)
        .regex(/^\d{1,3}(?:\.\d{1,6})?$/u),
      periodicity: z.enum(['monthly']),
    })
    .nullable()
    .optional(),
});
const reversalSchema = z.object({ reason: z.string().trim().min(1).max(500) });

const decimal = { pattern: '^\\d+(?:\\.\\d+)?$', type: 'string' } as const;
const changeProperties: Record<string, SchemaObject> = {
  amount: { ...decimal, nullable: true },
  discount: { ...decimal, nullable: true },
  effectiveCycleClosesOn: { format: 'date', nullable: true, type: 'string' },
  id: { format: 'uuid', type: 'string' },
  kind: { enum: ['prepayment', 'renegotiation', 'reversal'], type: 'string' },
  newPlanId: { format: 'uuid', nullable: true, type: 'string' },
  reason: { nullable: true, type: 'string' },
  recordedAt: { format: 'date-time', type: 'string' },
  reversed: { type: 'boolean' },
  reversedChangeId: { format: 'uuid', nullable: true, type: 'string' },
};
const situationProperties: Record<string, SchemaObject> = {
  amount: decimal,
  cycleClosesOn: { format: 'date', type: 'string' },
  number: { maximum: 420, minimum: 1, type: 'integer' },
  situation: {
    enum: ['invoiced', 'projected', 'prepaid', 'renegotiated'],
    type: 'string',
  },
};
const chainSchema: SchemaObject = {
  description:
    'Plans of a purchase, the original first and each renegotiated plan after the one it replaced, with their append-only changes.',
  properties: {
    plans: {
      items: {
        properties: {
          changes: {
            items: {
              properties: changeProperties,
              required: Object.keys(changeProperties),
              type: 'object',
            },
            type: 'array',
          },
          futureOutstanding: decimal,
          plan: installmentPlanSchema,
          situations: {
            items: {
              properties: situationProperties,
              required: Object.keys(situationProperties),
              type: 'object',
            },
            type: 'array',
          },
          status: {
            enum: ['active', 'prepaid', 'renegotiated'],
            type: 'string',
          },
        },
        required: [
          'changes',
          'futureOutstanding',
          'plan',
          'situations',
          'status',
        ],
        type: 'object',
      },
      type: 'array',
    },
    referenceCycleClosesOn: {
      description:
        'Invoice cycle open today; later installments are projected.',
      format: 'date',
      type: 'string',
    },
  },
  required: ['plans', 'referenceCycleClosesOn'],
  type: 'object',
};

type ChainResponse = Readonly<Record<string, unknown>>;

@Controller('credit-cards/:cardId/purchases/:purchaseId/installment-plan')
@ApiTags('credit-cards')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Bearer token missing or invalid' })
@ApiParam({ format: 'uuid', name: 'cardId', type: 'string' })
@ApiParam({ format: 'uuid', name: 'purchaseId', type: 'string' })
@UseGuards(BearerAuthGuard)
export class CardInstallmentPlanChangeController {
  public constructor(
    @Inject(GetCardInstallmentPlanChainUseCase)
    private readonly getChain: GetCardInstallmentPlanChainUseCase,
    @Inject(PrepayCardInstallmentPlanUseCase)
    private readonly prepay: PrepayCardInstallmentPlanUseCase,
    @Inject(RenegotiateCardInstallmentPlanUseCase)
    private readonly renegotiate: RenegotiateCardInstallmentPlanUseCase,
    @Inject(ReverseCardInstallmentPlanChangeUseCase)
    private readonly reverse: ReverseCardInstallmentPlanChangeUseCase,
    @Inject(AuthenticatedActorContext)
    private readonly actors: AuthenticatedActorContext,
  ) {}

  @Get('chain')
  @ApiOperation({
    summary:
      'Get every plan of a card purchase with its changes and situations',
  })
  @ApiOkResponse({ schema: chainSchema })
  @ApiNotFoundResponse({
    description: 'Owned card, purchase or plan not found',
  })
  public async chain(
    @Req() request: FastifyRequest,
    @Param('cardId', new ZodValidationPipe(uuidSchema)) cardId: string,
    @Param('purchaseId', new ZodValidationPipe(uuidSchema)) purchaseId: string,
  ): Promise<ChainResponse> {
    try {
      return mapChain(
        await this.getChain.execute({
          actorId: this.actorId(request),
          cardId,
          purchaseId,
        }),
      );
    } catch (error) {
      throw mapError(error);
    }
  }

  @Post('prepayment')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Declare an early settlement of the future installments agreed with the issuer',
  })
  @ApiHeader(idempotencyKeyHeader)
  @ApiBody({
    schema: {
      additionalProperties: false,
      properties: { amount: decimal, discount: decimal },
      required: ['amount', 'discount'],
      type: 'object',
    },
  })
  @ApiOkResponse({ schema: chainSchema })
  @ApiBadRequestResponse({ description: 'Invalid amounts or idempotency key' })
  @ApiNotFoundResponse({
    description: 'Owned card, purchase or plan not found',
  })
  @ApiConflictResponse({
    description: 'Idempotency key reused with a different payload',
  })
  @ApiUnprocessableEntityResponse({
    description:
      'Amount plus discount differ from the future installments, the plan is closed, or the open invoice is closed',
  })
  public async prepayment(
    @Req() request: FastifyRequest,
    @Param('cardId', new ZodValidationPipe(uuidSchema)) cardId: string,
    @Param('purchaseId', new ZodValidationPipe(uuidSchema)) purchaseId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body(new ZodValidationPipe(prepaymentSchema))
    body: z.infer<typeof prepaymentSchema>,
  ): Promise<ChainResponse> {
    const key = parseIdempotencyKeyHeader(idempotencyKey);
    try {
      return mapChain(
        await this.prepay.execute({
          ...body,
          actorId: this.actorId(request),
          cardId,
          idempotencyKey: key,
          purchaseId,
        }),
      );
    } catch (error) {
      throw mapError(error);
    }
  }

  @Post('renegotiation')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Register a renegotiation agreed with the issuer as a new linked plan',
  })
  @ApiHeader(idempotencyKeyHeader)
  @ApiBody({
    schema: {
      additionalProperties: false,
      properties: {
        count: { maximum: 420, minimum: 1, type: 'integer' },
        principal: decimal,
        rate: {
          additionalProperties: false,
          nullable: true,
          properties: {
            method: { enum: ['simple', 'compound'], type: 'string' },
            percentPerPeriod: {
              pattern: '^\\d{1,3}(?:\\.\\d{1,6})?$',
              type: 'string',
            },
            periodicity: { enum: ['monthly'], type: 'string' },
          },
          required: ['method', 'percentPerPeriod', 'periodicity'],
          type: 'object',
        },
      },
      required: ['count', 'principal'],
      type: 'object',
    },
  })
  @ApiOkResponse({ schema: chainSchema })
  @ApiBadRequestResponse({ description: 'Invalid terms or idempotency key' })
  @ApiNotFoundResponse({
    description: 'Owned card, purchase or plan not found',
  })
  @ApiConflictResponse({
    description: 'Idempotency key reused with a different payload',
  })
  @ApiUnprocessableEntityResponse({
    description:
      'The plan is closed, has no future installment, or a target invoice is closed',
  })
  public async renegotiation(
    @Req() request: FastifyRequest,
    @Param('cardId', new ZodValidationPipe(uuidSchema)) cardId: string,
    @Param('purchaseId', new ZodValidationPipe(uuidSchema)) purchaseId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body(new ZodValidationPipe(renegotiationSchema))
    body: z.infer<typeof renegotiationSchema>,
  ): Promise<ChainResponse> {
    const key = parseIdempotencyKeyHeader(idempotencyKey);
    try {
      return mapChain(
        await this.renegotiate.execute({
          actorId: this.actorId(request),
          cardId,
          count: body.count,
          idempotencyKey: key,
          principal: body.principal,
          purchaseId,
          rate: body.rate ?? null,
        }),
      );
    } catch (error) {
      throw mapError(error);
    }
  }

  @Post('changes/:changeId/reversal')
  @HttpCode(200)
  @ApiOperation({ summary: 'Reverse a declared prepayment with a reason' })
  @ApiParam({ format: 'uuid', name: 'changeId', type: 'string' })
  @ApiHeader(idempotencyKeyHeader)
  @ApiBody({
    schema: {
      additionalProperties: false,
      properties: { reason: { maxLength: 500, minLength: 1, type: 'string' } },
      required: ['reason'],
      type: 'object',
    },
  })
  @ApiOkResponse({ schema: chainSchema })
  @ApiBadRequestResponse({ description: 'Invalid reversal or idempotency key' })
  @ApiNotFoundResponse({
    description: 'Owned card, purchase or plan not found',
  })
  @ApiConflictResponse({
    description: 'Idempotency key reused with a different payload',
  })
  public async reversal(
    @Req() request: FastifyRequest,
    @Param('cardId', new ZodValidationPipe(uuidSchema)) cardId: string,
    @Param('purchaseId', new ZodValidationPipe(uuidSchema)) purchaseId: string,
    @Param('changeId', new ZodValidationPipe(uuidSchema)) changeId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body(new ZodValidationPipe(reversalSchema))
    body: z.infer<typeof reversalSchema>,
  ): Promise<ChainResponse> {
    const key = parseIdempotencyKeyHeader(idempotencyKey);
    try {
      return mapChain(
        await this.reverse.execute({
          actorId: this.actorId(request),
          cardId,
          changeId,
          idempotencyKey: key,
          purchaseId,
          reason: body.reason,
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

function mapChain(view: CardPlanChainView): ChainResponse {
  return {
    plans: view.plans.map((record) => {
      const reversed = new Set(record.state.reversedChangeIds);
      return {
        changes: record.changes.map((change) => mapChange(change, reversed)),
        futureOutstanding: record.state.futureOutstanding.toDecimal(),
        plan: mapPlan(record.plan),
        situations: record.state.installments.map((item) => ({
          amount: item.amount.toDecimal(),
          cycleClosesOn: item.cycleClosesOn,
          number: item.number,
          situation: item.situation,
        })),
        status: record.state.status,
      };
    }),
    referenceCycleClosesOn: view.referenceCycleClosesOn,
  };
}

function mapChange(
  change: CardPlanChange,
  reversed: ReadonlySet<string>,
): Record<string, unknown> {
  return {
    amount: change.kind === 'prepayment' ? change.amount.amount : null,
    discount: change.kind === 'prepayment' ? change.discount.amount : null,
    effectiveCycleClosesOn:
      change.kind === 'reversal' ? null : change.effectiveCycleClosesOn,
    id: change.id,
    kind: change.kind,
    newPlanId: change.kind === 'renegotiation' ? change.newPlanId : null,
    reason: change.kind === 'reversal' ? change.reason : null,
    recordedAt: new Date(change.recordedAt).toISOString(),
    reversed: reversed.has(change.id),
    reversedChangeId:
      change.kind === 'reversal' ? change.reversedChangeId : null,
  };
}

function mapError(error: unknown): Error {
  const idempotencyError = mapIdempotencyError(error);
  if (idempotencyError !== undefined) return idempotencyError;
  if (
    error instanceof CreditCardNotFoundError ||
    error instanceof CardPurchaseNotFoundError ||
    error instanceof CardInstallmentPlanNotFoundError
  ) {
    return new NotFoundException('Credit card, purchase or plan not found.');
  }
  if (
    error instanceof CardPlanPrepaymentMismatchError ||
    error instanceof CardPlanClosedError ||
    error instanceof CardPlanWithoutFutureInstallmentsError ||
    error instanceof CardInstallmentInvoiceClosedError ||
    error instanceof CardInstallmentSettledAboveObligationError
  ) {
    return new UnprocessableEntityException(error.message);
  }
  if (
    error instanceof InvalidCardPlanChangeError ||
    error instanceof InvalidInstallmentPlanError ||
    error instanceof InvalidInterestRateError ||
    error instanceof InvalidMoneyAmountError
  ) {
    return new BadRequestException('Invalid installment plan change.');
  }
  return error instanceof Error
    ? error
    : new Error('Unknown installment plan change error.');
}
