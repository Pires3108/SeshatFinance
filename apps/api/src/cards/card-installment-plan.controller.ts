import {
  CardInstallmentInvoiceClosedError,
  CardInstallmentSettledAboveObligationError,
  CardPurchaseAlreadyInstalledError,
  CardPurchaseNotFoundError,
  CreditCardNotFoundError,
  GetCardInstallmentPlanUseCase,
  PreviewCardInstallmentPlanUseCase,
  RegisterCardInstallmentPlanUseCase,
  type CardInstallmentPlanPreview,
} from '@seshat/application';
import {
  InvalidInstallmentPlanError,
  InvalidInterestRateError,
  type CardInstallmentPlan,
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

const uuidSchema = z.uuid();
const planSchema = z.object({
  count: z.number().int().min(1).max(420),
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
type PlanRequest = z.infer<typeof planSchema>;

type Rate = Readonly<{
  method: 'simple' | 'compound';
  percentPerPeriod: string;
  periodicity: 'monthly';
}>;
type ScheduleLine = Readonly<{
  amount: string;
  cycleClosesOn: string;
  interest: string;
  number: number;
  principal: string;
}>;
type PlanBody = Readonly<{
  calculationVersion: number;
  count: number;
  currencyCode: string;
  currencyMinorUnitScale: number;
  interest: string;
  principal: string;
  rate: Rate | null;
  total: string;
}>;
export type InstallmentPreviewResponse = PlanBody &
  Readonly<{
    installments: readonly (ScheduleLine & Readonly<{ dueOn: string }>)[];
  }>;
export type InstallmentPlanResponse = PlanBody &
  Readonly<{
    cardId: string;
    createdAt: string;
    id: string;
    installments: readonly (ScheduleLine & Readonly<{ id: string }>)[];
    purchaseId: string;
    status: 'active';
  }>;

const decimal = { pattern: '^\\d+(?:\\.\\d+)?$', type: 'string' } as const;
const civilDate = { format: 'date', type: 'string' } as const;
const rateSchema: SchemaObject = {
  additionalProperties: false,
  description:
    'Declared rate (ADR-042): percentage per period, 0 to 100 with up to six decimal places; only the monthly schedule period is accepted.',
  nullable: true,
  properties: {
    method: { enum: ['simple', 'compound'], type: 'string' },
    percentPerPeriod: { pattern: '^\\d{1,3}(?:\\.\\d{1,6})?$', type: 'string' },
    periodicity: { enum: ['monthly'], type: 'string' },
  },
  required: ['method', 'percentPerPeriod', 'periodicity'],
  type: 'object',
};
const planBodyProperties: Record<string, SchemaObject> = {
  calculationVersion: { minimum: 1, type: 'integer' },
  count: { maximum: 420, minimum: 1, type: 'integer' },
  currencyCode: { pattern: '^[A-Z]{3}$', type: 'string' },
  currencyMinorUnitScale: { maximum: 18, minimum: 0, type: 'integer' },
  interest: { ...decimal, description: 'Estimated interest.' },
  principal: decimal,
  rate: rateSchema,
  total: {
    ...decimal,
    description:
      'Exact total rounded once, half up, to the currency scale (ADR-042).',
  },
};
const lineProperties: Record<string, SchemaObject> = {
  amount: decimal,
  cycleClosesOn: {
    ...civilDate,
    description: 'Closing date of the invoice the installment composes.',
  },
  interest: decimal,
  number: { maximum: 420, minimum: 1, type: 'integer' },
  principal: decimal,
};
function scheduleSchema(extra: Record<string, SchemaObject>): SchemaObject {
  const properties = { ...lineProperties, ...extra };
  return {
    items: { properties, required: Object.keys(properties), type: 'object' },
    type: 'array',
  };
}
const previewSchema: SchemaObject = {
  description:
    'RN-021 preview: principal, interest, total, value and due date of each installment. Nothing is recorded.',
  properties: {
    ...planBodyProperties,
    installments: scheduleSchema({
      dueOn: { ...civilDate, description: 'Effective due date.' },
    }),
  },
  required: [...Object.keys(planBodyProperties), 'installments'],
  type: 'object',
};
const planProperties: Record<string, SchemaObject> = {
  ...planBodyProperties,
  cardId: { format: 'uuid', type: 'string' },
  createdAt: { format: 'date-time', type: 'string' },
  id: { format: 'uuid', type: 'string' },
  installments: scheduleSchema({ id: { format: 'uuid', type: 'string' } }),
  purchaseId: { format: 'uuid', type: 'string' },
  status: { enum: ['active'], type: 'string' },
};
export const installmentPlanSchema: SchemaObject = {
  description:
    'Frozen installment plan of a recorded purchase: the purchase stays the expense and each installment composes the invoice of its cycle.',
  properties: planProperties,
  required: Object.keys(planProperties),
  type: 'object',
};
const requestBody: SchemaObject = {
  additionalProperties: false,
  properties: {
    count: { maximum: 420, minimum: 1, type: 'integer' },
    rate: rateSchema,
  },
  required: ['count'],
  type: 'object',
};

@Controller('credit-cards/:cardId/purchases/:purchaseId/installment-plan')
@ApiTags('credit-cards')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Bearer token missing or invalid' })
@ApiParam({ format: 'uuid', name: 'cardId', type: 'string' })
@ApiParam({ format: 'uuid', name: 'purchaseId', type: 'string' })
@UseGuards(BearerAuthGuard)
export class CardInstallmentPlanController {
  public constructor(
    @Inject(PreviewCardInstallmentPlanUseCase)
    private readonly previewPlan: PreviewCardInstallmentPlanUseCase,
    @Inject(RegisterCardInstallmentPlanUseCase)
    private readonly registerPlan: RegisterCardInstallmentPlanUseCase,
    @Inject(GetCardInstallmentPlanUseCase)
    private readonly getPlan: GetCardInstallmentPlanUseCase,
    @Inject(AuthenticatedActorContext)
    private readonly actors: AuthenticatedActorContext,
  ) {}

  @Post('preview')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Preview splitting a recorded card purchase into installments',
  })
  @ApiBody({ schema: requestBody })
  @ApiOkResponse({ schema: previewSchema })
  @ApiBadRequestResponse({ description: 'Invalid count or rate' })
  @ApiNotFoundResponse({ description: 'Owned card or purchase not found' })
  public async preview(
    @Req() request: FastifyRequest,
    @Param('cardId', new ZodValidationPipe(uuidSchema)) cardId: string,
    @Param('purchaseId', new ZodValidationPipe(uuidSchema)) purchaseId: string,
    @Body(new ZodValidationPipe(planSchema)) body: PlanRequest,
  ): Promise<InstallmentPreviewResponse> {
    try {
      return mapPreview(
        await this.previewPlan.execute({
          actorId: this.actorId(request),
          cardId,
          count: body.count,
          purchaseId,
          rate: body.rate ?? null,
        }),
      );
    } catch (error) {
      throw mapError(error);
    }
  }

  @Post()
  @ApiOperation({
    summary:
      'Split a recorded card purchase into installments (declaration only)',
  })
  @ApiHeader(idempotencyKeyHeader)
  @ApiBody({ schema: requestBody })
  @ApiCreatedResponse({ schema: installmentPlanSchema })
  @ApiBadRequestResponse({
    description: 'Invalid count, rate or idempotency key',
  })
  @ApiNotFoundResponse({ description: 'Owned card or purchase not found' })
  @ApiConflictResponse({
    description:
      'Purchase already split, or idempotency key reused with a different payload',
  })
  @ApiUnprocessableEntityResponse({
    description:
      'A target invoice is closed, or settlements already exceed the new obligation',
  })
  public async create(
    @Req() request: FastifyRequest,
    @Param('cardId', new ZodValidationPipe(uuidSchema)) cardId: string,
    @Param('purchaseId', new ZodValidationPipe(uuidSchema)) purchaseId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body(new ZodValidationPipe(planSchema)) body: PlanRequest,
  ): Promise<InstallmentPlanResponse> {
    const key = parseIdempotencyKeyHeader(idempotencyKey);
    try {
      return mapPlan(
        await this.registerPlan.execute({
          actorId: this.actorId(request),
          cardId,
          count: body.count,
          idempotencyKey: key,
          purchaseId,
          rate: body.rate ?? null,
        }),
      );
    } catch (error) {
      throw mapError(error);
    }
  }

  @Get()
  @ApiOperation({ summary: 'Get the installment plan of a card purchase' })
  @ApiOkResponse({ schema: installmentPlanSchema })
  @ApiNotFoundResponse({
    description: 'Owned card, purchase or installment plan not found',
  })
  public async get(
    @Req() request: FastifyRequest,
    @Param('cardId', new ZodValidationPipe(uuidSchema)) cardId: string,
    @Param('purchaseId', new ZodValidationPipe(uuidSchema)) purchaseId: string,
  ): Promise<InstallmentPlanResponse> {
    let plan: CardInstallmentPlan | null;
    try {
      plan = await this.getPlan.execute({
        actorId: this.actorId(request),
        cardId,
        purchaseId,
      });
    } catch (error) {
      throw mapError(error);
    }
    if (plan === null) {
      throw new NotFoundException('Installment plan not found.');
    }
    return mapPlan(plan);
  }

  private actorId(request: FastifyRequest): string {
    const actor = this.actors.get(request);
    if (actor === undefined) throw new UnauthorizedException();
    return actor.id;
  }
}

function mapPreview(
  preview: CardInstallmentPlanPreview,
): InstallmentPreviewResponse {
  const { plan, cycles } = preview;
  return {
    calculationVersion: plan.memory.calculationVersion,
    count: plan.memory.count,
    currencyCode: plan.total.currency.code,
    currencyMinorUnitScale: plan.total.currency.minorUnitScale,
    installments: plan.installments.map((installment, index) => {
      const cycle = cycles[index];
      if (cycle === undefined) throw new Error('Installment without cycle.');
      return {
        amount: installment.amount.toDecimal(),
        cycleClosesOn: cycle.closesOn.toString(),
        dueOn: cycle.dueOn.toString(),
        interest: installment.interest.toDecimal(),
        number: installment.number,
        principal: installment.principal.toDecimal(),
      };
    }),
    interest: plan.interest.toDecimal(),
    principal: plan.principal.toDecimal(),
    rate: plan.memory.rate,
    total: plan.total.toDecimal(),
  };
}

export function mapPlan(plan: CardInstallmentPlan): InstallmentPlanResponse {
  const value = plan.toSnapshot();
  return {
    calculationVersion: value.calculationVersion,
    cardId: value.cardId,
    count: value.count,
    createdAt: value.createdAt.toISOString(),
    currencyCode: value.total.currency.code,
    currencyMinorUnitScale: value.total.currency.minorUnitScale,
    id: value.id,
    installments: value.installments.map((installment) => ({
      amount: installment.amount.amount,
      cycleClosesOn: installment.cycleClosesOn,
      id: installment.id,
      interest: installment.interest.amount,
      number: installment.number,
      principal: installment.principal.amount,
    })),
    interest: value.interest.amount,
    principal: value.principal.amount,
    purchaseId: value.purchaseId,
    rate: value.rate,
    status: value.status,
    total: value.total.amount,
  };
}

function mapError(error: unknown): Error {
  const idempotencyError = mapIdempotencyError(error);
  if (idempotencyError !== undefined) return idempotencyError;
  if (
    error instanceof CreditCardNotFoundError ||
    error instanceof CardPurchaseNotFoundError
  ) {
    return new NotFoundException('Credit card or purchase not found.');
  }
  if (error instanceof CardPurchaseAlreadyInstalledError) {
    return new ConflictException(
      'The purchase already has an installment plan.',
    );
  }
  if (error instanceof CardInstallmentInvoiceClosedError) {
    return new UnprocessableEntityException(
      'Every invoice of the installment plan must be open.',
    );
  }
  if (error instanceof CardInstallmentSettledAboveObligationError) {
    return new UnprocessableEntityException(
      'Settlements already declared exceed the new invoice obligation.',
    );
  }
  if (
    error instanceof InvalidInstallmentPlanError ||
    error instanceof InvalidInterestRateError
  ) {
    return new BadRequestException('Invalid installment plan.');
  }
  return error instanceof Error
    ? error
    : new Error('Unknown installment plan error.');
}
