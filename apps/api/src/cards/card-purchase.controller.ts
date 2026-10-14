import {
  CardPurchaseCurrencyMismatchError,
  CardPurchaseIdempotencyConflictError,
  InvalidCardPurchaseIdempotencyKeyError,
  OwnedCreditCardNotFoundError,
  RegisterCardPurchaseUseCase,
} from '@seshat/application';
import {
  InvalidCardPurchaseError,
  InvalidCurrencyError,
  InvalidMoneyAmountError,
  type CardPurchase,
} from '@seshat/domain';
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Headers,
  Inject,
  NotFoundException,
  Param,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  type SchemaObject,
} from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';

import { AuthenticatedActorContext } from '../auth/authenticated-actor-context.js';
import { BearerAuthGuard } from '../auth/bearer-auth.guard.js';
import { ZodValidationPipe } from '../platform/zod-validation.pipe.js';

const bodySchema = z.strictObject({
  amount: z
    .string()
    .max(1002)
    .regex(/^\d+(?:\.\d+)?$/u),
  currencyCode: z.string().regex(/^[A-Z]{3}$/u),
  currencyMinorUnitScale: z.number().int().min(0).max(18),
  description: z.string().trim().min(1).max(500),
  externalId: z.string().trim().min(1).max(255).optional(),
  occurredAt: z.iso.datetime({ offset: true }),
});
type BodyRequest = z.infer<typeof bodySchema>;
type Response = Readonly<{
  amount: string;
  cardId: string;
  createdAt: string;
  currencyCode: string;
  currencyMinorUnitScale: number;
  description: string;
  externalId: string | null;
  id: string;
  occurredAt: string;
  replayed: boolean;
}>;
const responseSchema: SchemaObject = {
  type: 'object',
  properties: {
    amount: { type: 'string' },
    cardId: { type: 'string', format: 'uuid' },
    createdAt: { type: 'string', format: 'date-time' },
    currencyCode: { type: 'string' },
    currencyMinorUnitScale: { type: 'integer' },
    description: { type: 'string' },
    externalId: { type: 'string', nullable: true },
    id: { type: 'string', format: 'uuid' },
    occurredAt: { type: 'string', format: 'date-time' },
    replayed: { type: 'boolean' },
  },
  required: [
    'amount',
    'cardId',
    'createdAt',
    'currencyCode',
    'currencyMinorUnitScale',
    'description',
    'externalId',
    'id',
    'occurredAt',
    'replayed',
  ],
};

@Controller('credit-cards/:cardId/purchases')
@ApiTags('credit-card-purchases')
@ApiBearerAuth()
@UseGuards(BearerAuthGuard)
export class CardPurchaseController {
  public constructor(
    @Inject(RegisterCardPurchaseUseCase)
    private readonly registerPurchase: RegisterCardPurchaseUseCase,
    @Inject(AuthenticatedActorContext)
    private readonly actors: AuthenticatedActorContext,
  ) {}

  @Post()
  @ApiOperation({
    summary:
      'Record a completed external card purchase; no payment is initiated',
  })
  @ApiParam({ name: 'cardId', type: 'string', format: 'uuid' })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiBody({
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        amount: { type: 'string', pattern: '^\\d+(?:\\.\\d+)?$' },
        currencyCode: { type: 'string', pattern: '^[A-Z]{3}$' },
        currencyMinorUnitScale: { type: 'integer', minimum: 0, maximum: 18 },
        description: { type: 'string', minLength: 1, maxLength: 500 },
        externalId: { type: 'string', minLength: 1, maxLength: 255 },
        occurredAt: { type: 'string', format: 'date-time' },
      },
      required: [
        'amount',
        'currencyCode',
        'currencyMinorUnitScale',
        'description',
        'occurredAt',
      ],
    },
  })
  @ApiCreatedResponse({ schema: responseSchema })
  @ApiNotFoundResponse({ description: 'Owned card not found' })
  @ApiConflictResponse({
    description: 'Idempotency key reused with different purchase',
  })
  public async create(
    @Req() request: FastifyRequest,
    @Param('cardId', new ZodValidationPipe(z.uuid())) cardId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body(new ZodValidationPipe(bodySchema)) body: BodyRequest,
  ): Promise<Response> {
    const actor = this.actors.get(request);
    if (actor === undefined) throw new UnauthorizedException();
    if (idempotencyKey === undefined || idempotencyKey.length > 255)
      throw new BadRequestException('Valid idempotency key required.');
    try {
      const result = await this.registerPurchase.execute({
        actorId: actor.id,
        cardId,
        idempotencyKey,
        amount: body.amount,
        currencyCode: body.currencyCode,
        currencyMinorUnitScale: body.currencyMinorUnitScale,
        description: body.description,
        externalId: body.externalId,
        occurredAt: new Date(body.occurredAt),
      });
      return mapPurchase(result.purchase, result.replayed);
    } catch (error) {
      if (error instanceof OwnedCreditCardNotFoundError)
        throw new NotFoundException('Credit card not found.');
      if (error instanceof CardPurchaseIdempotencyConflictError)
        throw new ConflictException('Idempotency key conflict.');
      if (
        error instanceof InvalidCardPurchaseError ||
        error instanceof InvalidCardPurchaseIdempotencyKeyError ||
        error instanceof InvalidCurrencyError ||
        error instanceof InvalidMoneyAmountError ||
        error instanceof CardPurchaseCurrencyMismatchError
      )
        throw new BadRequestException('Invalid card purchase.');
      throw error;
    }
  }
}

function mapPurchase(purchase: CardPurchase, replayed: boolean): Response {
  const value = purchase.toSnapshot();
  return {
    amount: value.amount.amount,
    cardId: value.cardId,
    createdAt: value.createdAt.toISOString(),
    currencyCode: value.amount.currency.code,
    currencyMinorUnitScale: value.amount.currency.minorUnitScale,
    description: value.description,
    externalId: value.externalId,
    id: value.id,
    occurredAt: value.occurredAt.toISOString(),
    replayed,
  };
}
