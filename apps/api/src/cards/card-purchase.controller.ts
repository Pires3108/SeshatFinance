import {
  CardPurchaseCategoryUnavailableError,
  CardPurchaseCurrencyMismatchError,
  CreditCardNotFoundError,
  ListCardPurchasesUseCase,
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
  Controller,
  Get,
  Headers,
  Inject,
  NotFoundException,
  Param,
  Post,
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

const cardIdSchema = z.uuid();
const createSchema = z.object({
  amount: z
    .string()
    .max(1002)
    .regex(/^\d+(?:\.\d+)?$/u),
  categoryId: z.uuid().nullable().optional(),
  currencyCode: z.string().regex(/^[A-Z]{3}$/u),
  currencyMinorUnitScale: z.number().int().min(0).max(18),
  description: z.string().trim().min(1).max(500),
  externalId: z.string().max(255).nullable().optional(),
  occurredAt: z.iso.datetime({ offset: true }),
});
const listSchema = z.object({
  cycleClosesOn: z.iso.date().optional(),
});

type CreateRequest = z.infer<typeof createSchema>;
type ListRequest = z.infer<typeof listSchema>;
type PurchaseResponse = Readonly<{
  amount: string;
  cardId: string;
  categoryId: string | null;
  createdAt: string;
  currencyCode: string;
  currencyMinorUnitScale: number;
  cycleClosesOn: string;
  description: string;
  externalId: string | null;
  id: string;
  occurredAt: string;
}>;

const decimal = {
  pattern: '^\\d+(?:\\.\\d+)?$',
  type: 'string',
} as const;
const purchaseSchema: SchemaObject = {
  description:
    'A purchase already made outside Seshat Finance: one expense and the same card obligation. It never changes the paying account balance.',
  properties: {
    amount: decimal,
    cardId: { format: 'uuid', type: 'string' },
    categoryId: { format: 'uuid', nullable: true, type: 'string' },
    createdAt: { format: 'date-time', type: 'string' },
    currencyCode: { pattern: '^[A-Z]{3}$', type: 'string' },
    currencyMinorUnitScale: { maximum: 18, minimum: 0, type: 'integer' },
    cycleClosesOn: {
      description: 'Closing date of the single cycle the purchase belongs to.',
      format: 'date',
      type: 'string',
    },
    description: { type: 'string' },
    externalId: { nullable: true, type: 'string' },
    id: { format: 'uuid', type: 'string' },
    occurredAt: { format: 'date-time', type: 'string' },
  },
  required: [
    'amount',
    'cardId',
    'categoryId',
    'createdAt',
    'currencyCode',
    'currencyMinorUnitScale',
    'cycleClosesOn',
    'description',
    'externalId',
    'id',
    'occurredAt',
  ],
  type: 'object',
};

@Controller('credit-cards/:cardId/purchases')
@ApiTags('credit-cards')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Bearer token missing or invalid' })
@UseGuards(BearerAuthGuard)
export class CardPurchaseController {
  public constructor(
    @Inject(RegisterCardPurchaseUseCase)
    private readonly registerPurchase: RegisterCardPurchaseUseCase,
    @Inject(ListCardPurchasesUseCase)
    private readonly listPurchases: ListCardPurchasesUseCase,
    @Inject(AuthenticatedActorContext)
    private readonly actors: AuthenticatedActorContext,
  ) {}

  @Post()
  @ApiOperation({
    summary: 'Record a purchase already made with an owned credit card',
  })
  @ApiParam({ format: 'uuid', name: 'cardId', type: 'string' })
  @ApiHeader(idempotencyKeyHeader)
  @ApiBody({
    schema: {
      additionalProperties: false,
      properties: {
        amount: decimal,
        categoryId: { format: 'uuid', nullable: true, type: 'string' },
        currencyCode: { pattern: '^[A-Z]{3}$', type: 'string' },
        currencyMinorUnitScale: { maximum: 18, minimum: 0, type: 'integer' },
        description: { maxLength: 500, minLength: 1, type: 'string' },
        externalId: { maxLength: 255, nullable: true, type: 'string' },
        occurredAt: { format: 'date-time', type: 'string' },
      },
      required: [
        'amount',
        'currencyCode',
        'currencyMinorUnitScale',
        'description',
        'occurredAt',
      ],
      type: 'object',
    },
  })
  @ApiCreatedResponse({ schema: purchaseSchema })
  @ApiBadRequestResponse({ description: 'Invalid request or idempotency key' })
  @ApiNotFoundResponse({ description: 'Owned card or category not found' })
  @ApiConflictResponse({
    description:
      'Idempotency key reused with a different payload or still in progress',
  })
  @ApiUnprocessableEntityResponse({
    description: 'Purchase currency differs from the card currency',
  })
  public async create(
    @Req() request: FastifyRequest,
    @Param('cardId', new ZodValidationPipe(cardIdSchema)) cardId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body(new ZodValidationPipe(createSchema)) body: CreateRequest,
  ): Promise<PurchaseResponse> {
    const key = parseIdempotencyKeyHeader(idempotencyKey);
    try {
      return mapPurchase(
        await this.registerPurchase.execute({
          ...body,
          actorId: this.actorId(request),
          cardId,
          idempotencyKey: key,
          occurredAt: new Date(body.occurredAt),
        }),
      );
    } catch (error) {
      throw mapError(error);
    }
  }

  @Get()
  @ApiOperation({ summary: 'List purchases of an owned credit card' })
  @ApiParam({ format: 'uuid', name: 'cardId', type: 'string' })
  @ApiQuery({
    description: 'Only purchases of the cycle closing on this date',
    format: 'date',
    name: 'cycleClosesOn',
    required: false,
    type: 'string',
  })
  @ApiOkResponse({ schema: { items: purchaseSchema, type: 'array' } })
  @ApiNotFoundResponse({ description: 'Owned card not found' })
  public async list(
    @Req() request: FastifyRequest,
    @Param('cardId', new ZodValidationPipe(cardIdSchema)) cardId: string,
    @Query(new ZodValidationPipe(listSchema)) query: ListRequest,
  ): Promise<readonly PurchaseResponse[]> {
    try {
      const purchases = await this.listPurchases.execute({
        actorId: this.actorId(request),
        cardId,
        ...(query.cycleClosesOn === undefined
          ? {}
          : { cycleClosesOn: query.cycleClosesOn }),
      });
      return purchases.map(mapPurchase);
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

function mapPurchase(purchase: CardPurchase): PurchaseResponse {
  const value = purchase.toSnapshot();
  return {
    amount: value.amount.amount,
    cardId: value.cardId,
    categoryId: value.categoryId,
    createdAt: value.createdAt.toISOString(),
    currencyCode: value.amount.currency.code,
    currencyMinorUnitScale: value.amount.currency.minorUnitScale,
    cycleClosesOn: value.cycleClosesOn,
    description: value.description,
    externalId: value.externalId,
    id: value.id,
    occurredAt: value.occurredAt.toISOString(),
  };
}

function mapError(error: unknown): Error {
  const idempotencyError = mapIdempotencyError(error);
  if (idempotencyError !== undefined) return idempotencyError;
  if (
    error instanceof CreditCardNotFoundError ||
    error instanceof CardPurchaseCategoryUnavailableError
  ) {
    return new NotFoundException('Credit card or category not found.');
  }
  if (error instanceof CardPurchaseCurrencyMismatchError) {
    return new UnprocessableEntityException(
      'Purchase currency must match the card currency.',
    );
  }
  if (
    error instanceof InvalidCardPurchaseError ||
    error instanceof InvalidCurrencyError ||
    error instanceof InvalidMoneyAmountError
  ) {
    return new BadRequestException('Invalid card purchase.');
  }
  return error instanceof Error ? error : new Error('Unknown purchase error.');
}
