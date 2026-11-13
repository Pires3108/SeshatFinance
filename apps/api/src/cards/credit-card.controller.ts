import {
  CreateCreditCardUseCase,
  CreditCardCurrencyMismatchError,
  CreditCardNotFoundError,
  CreditCardPaymentAccountUnavailableError,
  CreditCardVersionConflictError,
  GetCreditCardCycleUseCase,
  GetOwnedCreditCardUseCase,
  ListOwnedCreditCardsUseCase,
  UpdateCreditCardUseCase,
  type CreditCardCycleView,
} from '@seshat/application';
import {
  CARD_CLOSING_BOUNDARIES,
  InvalidCreditCardError,
  InvalidCurrencyError,
  InvalidMoneyAmountError,
  type CreditCard,
} from '@seshat/domain';
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
  ApiUnauthorizedResponse,
  type SchemaObject,
} from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';

import { AuthenticatedActorContext } from '../auth/authenticated-actor-context.js';
import { BearerAuthGuard } from '../auth/bearer-auth.guard.js';
import { ZodValidationPipe } from '../platform/zod-validation.pipe.js';

const closingBoundarySchema = z.enum(['next-cycle', 'closing-cycle']);
const limitSchema = z
  .string()
  .max(1002)
  .regex(/^\d+(?:\.\d+)?$/u);
const cycleDaySchema = z.number().int().min(1).max(31);

const createSchema = z.object({
  brand: z.string().trim().min(1),
  closingBoundary: closingBoundarySchema.optional(),
  closingDay: cycleDaySchema,
  currencyCode: z.string().regex(/^[A-Z]{3}$/u),
  currencyMinorUnitScale: z.number().int().min(0).max(18),
  dueDay: cycleDaySchema,
  limit: limitSchema,
  name: z.string().trim().min(1),
  paymentAccountId: z.uuid(),
});
const updateSchema = z.object({
  brand: z.string().trim().min(1),
  closingBoundary: closingBoundarySchema,
  closingDay: cycleDaySchema,
  dueDay: cycleDaySchema,
  expectedVersion: z.number().int().min(1),
  limit: limitSchema,
  name: z.string().trim().min(1),
});
const cycleQuerySchema = z.object({
  at: z.iso.datetime({ offset: true }).optional(),
});
const cardIdSchema = z.uuid();

type CreateRequest = z.infer<typeof createSchema>;
type UpdateRequest = z.infer<typeof updateSchema>;
type CycleQuery = z.infer<typeof cycleQuerySchema>;
type Response = Readonly<{
  brand: string;
  closingBoundary: string;
  closingDay: number;
  createdAt: string;
  currencyCode: string;
  currencyMinorUnitScale: number;
  dueDay: number;
  id: string;
  limit: string;
  name: string;
  paymentAccountId: string;
  version: number;
}>;
type CycleResponse = Readonly<{
  cardId: string;
  closesOn: string;
  configurationPending: boolean;
  dueOn: string;
  firstPurchaseDate: string;
  holidayDatasetVersion: string;
  lastPurchaseDate: string;
  purchaseDate: string;
  scheduledDueOn: string;
  timeZone: string;
}>;

const civilDate = { format: 'date', type: 'string' } as const;
const closingBoundaryProperty: SchemaObject = {
  description:
    'next-cycle: a purchase on the closing date opens the next invoice; closing-cycle: it stays in the closing invoice.',
  enum: [...CARD_CLOSING_BOUNDARIES],
  type: 'string',
};

const responseSchema: SchemaObject = {
  properties: {
    brand: { type: 'string' },
    closingBoundary: closingBoundaryProperty,
    closingDay: { maximum: 31, minimum: 1, type: 'integer' },
    createdAt: { format: 'date-time', type: 'string' },
    currencyCode: { pattern: '^[A-Z]{3}$', type: 'string' },
    currencyMinorUnitScale: { maximum: 18, minimum: 0, type: 'integer' },
    dueDay: { maximum: 31, minimum: 1, type: 'integer' },
    id: { format: 'uuid', type: 'string' },
    limit: {
      description:
        'Organizational estimate only; it never blocks or releases a real card limit.',
      pattern: '^\\d+(?:\\.\\d+)?$',
      type: 'string',
    },
    name: { type: 'string' },
    paymentAccountId: { format: 'uuid', type: 'string' },
    version: { minimum: 1, type: 'integer' },
  },
  required: [
    'brand',
    'closingBoundary',
    'closingDay',
    'createdAt',
    'currencyCode',
    'currencyMinorUnitScale',
    'dueDay',
    'id',
    'limit',
    'name',
    'paymentAccountId',
    'version',
  ],
  type: 'object',
};

const cycleResponseSchema: SchemaObject = {
  properties: {
    cardId: { format: 'uuid', type: 'string' },
    closesOn: civilDate,
    configurationPending: { type: 'boolean' },
    dueOn: {
      ...civilDate,
      description: 'Due date after skipping weekends and holidays.',
    },
    firstPurchaseDate: civilDate,
    holidayDatasetVersion: { type: 'string' },
    lastPurchaseDate: civilDate,
    purchaseDate: civilDate,
    scheduledDueOn: civilDate,
    timeZone: { type: 'string' },
  },
  required: [
    'cardId',
    'closesOn',
    'configurationPending',
    'dueOn',
    'firstPurchaseDate',
    'holidayDatasetVersion',
    'lastPurchaseDate',
    'purchaseDate',
    'scheduledDueOn',
    'timeZone',
  ],
  type: 'object',
};

@Controller('credit-cards')
@ApiTags('credit-cards')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Bearer token missing or invalid' })
@UseGuards(BearerAuthGuard)
export class CreditCardController {
  public constructor(
    @Inject(CreateCreditCardUseCase)
    private readonly createCard: CreateCreditCardUseCase,
    @Inject(GetOwnedCreditCardUseCase)
    private readonly getCard: GetOwnedCreditCardUseCase,
    @Inject(ListOwnedCreditCardsUseCase)
    private readonly listCards: ListOwnedCreditCardsUseCase,
    @Inject(UpdateCreditCardUseCase)
    private readonly updateCard: UpdateCreditCardUseCase,
    @Inject(GetCreditCardCycleUseCase)
    private readonly getCycle: GetCreditCardCycleUseCase,
    @Inject(AuthenticatedActorContext)
    private readonly actors: AuthenticatedActorContext,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Register an owned organizational credit card' })
  @ApiBody({ schema: createBodySchema() })
  @ApiCreatedResponse({ schema: responseSchema })
  @ApiNotFoundResponse({ description: 'Owned active account was not found' })
  public async create(
    @Req() request: FastifyRequest,
    @Body(new ZodValidationPipe(createSchema)) body: CreateRequest,
  ): Promise<Response> {
    try {
      return mapCard(
        await this.createCard.execute({
          actorId: this.actorId(request),
          ...body,
        }),
      );
    } catch (error) {
      throw mapError(error);
    }
  }

  @Get()
  @ApiOperation({
    summary: 'List credit cards owned by the authenticated user',
  })
  @ApiOkResponse({ schema: { items: responseSchema, type: 'array' } })
  public async list(
    @Req() request: FastifyRequest,
  ): Promise<readonly Response[]> {
    const cards = await this.listCards.execute(this.actorId(request));
    return cards.map(mapCard);
  }

  @Get(':cardId')
  @ApiOperation({
    summary: 'Get a credit card owned by the authenticated user',
  })
  @ApiParam({ format: 'uuid', name: 'cardId', type: 'string' })
  @ApiOkResponse({ schema: responseSchema })
  @ApiNotFoundResponse({ description: 'Owned credit card was not found' })
  public async get(
    @Req() request: FastifyRequest,
    @Param('cardId', new ZodValidationPipe(cardIdSchema)) cardId: string,
  ): Promise<Response> {
    const card = await this.getCard.execute(cardId, this.actorId(request));
    if (card === null) throw new NotFoundException('Credit card not found.');
    return mapCard(card);
  }

  @Patch(':cardId')
  @ApiOperation({
    summary: 'Change organizational settings of an owned credit card',
  })
  @ApiParam({ format: 'uuid', name: 'cardId', type: 'string' })
  @ApiBody({ schema: updateBodySchema() })
  @ApiOkResponse({ schema: responseSchema })
  @ApiNotFoundResponse({ description: 'Owned credit card was not found' })
  @ApiConflictResponse({ description: 'Card was modified concurrently' })
  public async update(
    @Req() request: FastifyRequest,
    @Param('cardId', new ZodValidationPipe(cardIdSchema)) cardId: string,
    @Body(new ZodValidationPipe(updateSchema)) body: UpdateRequest,
  ): Promise<Response> {
    try {
      return mapCard(
        await this.updateCard.execute({
          actorId: this.actorId(request),
          cardId,
          ...body,
        }),
      );
    } catch (error) {
      throw mapError(error);
    }
  }

  @Get(':cardId/cycle')
  @ApiOperation({
    summary:
      'Get the billing cycle that contains a purchase made at an instant (default: now)',
  })
  @ApiParam({ format: 'uuid', name: 'cardId', type: 'string' })
  @ApiQuery({
    format: 'date-time',
    name: 'at',
    required: false,
    type: 'string',
  })
  @ApiOkResponse({ schema: cycleResponseSchema })
  @ApiNotFoundResponse({ description: 'Owned credit card was not found' })
  public async cycle(
    @Req() request: FastifyRequest,
    @Param('cardId', new ZodValidationPipe(cardIdSchema)) cardId: string,
    @Query(new ZodValidationPipe(cycleQuerySchema)) query: CycleQuery,
  ): Promise<CycleResponse> {
    try {
      return mapCycle(
        await this.getCycle.execute({
          actorId: this.actorId(request),
          cardId,
          ...(query.at === undefined ? {} : { at: new Date(query.at) }),
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

function mapCard(card: CreditCard): Response {
  const value = card.toSnapshot();
  return {
    brand: value.brand,
    closingBoundary: value.closingBoundary,
    closingDay: value.closingDay,
    createdAt: value.createdAt.toISOString(),
    currencyCode: value.limit.currency.code,
    currencyMinorUnitScale: value.limit.currency.minorUnitScale,
    dueDay: value.dueDay,
    id: value.id,
    limit: value.limit.amount,
    name: value.name,
    paymentAccountId: value.paymentAccountId,
    version: value.version,
  };
}

function mapCycle(view: CreditCardCycleView): CycleResponse {
  return {
    cardId: view.card.id,
    closesOn: view.cycle.closesOn.toString(),
    configurationPending: view.cycle.configurationPending,
    dueOn: view.cycle.dueOn.toString(),
    firstPurchaseDate: view.cycle.firstPurchaseDate.toString(),
    holidayDatasetVersion: view.holidayDatasetVersion,
    lastPurchaseDate: view.cycle.lastPurchaseDate.toString(),
    purchaseDate: view.purchaseDate.toString(),
    scheduledDueOn: view.cycle.scheduledDueOn.toString(),
    timeZone: view.timeZone,
  };
}

function mapError(error: unknown): Error {
  if (error instanceof CreditCardPaymentAccountUnavailableError) {
    return new NotFoundException('Payment account not found.');
  }
  if (error instanceof CreditCardNotFoundError) {
    return new NotFoundException('Credit card not found.');
  }
  if (error instanceof CreditCardVersionConflictError) {
    return new ConflictException('Credit card was modified concurrently.');
  }
  if (
    error instanceof CreditCardCurrencyMismatchError ||
    error instanceof InvalidCreditCardError ||
    error instanceof InvalidCurrencyError ||
    error instanceof InvalidMoneyAmountError
  ) {
    return new BadRequestException('Invalid credit card operation.');
  }
  return error instanceof Error
    ? error
    : new Error('Unknown credit card error.');
}

function settingsProperties(): Record<string, SchemaObject> {
  return {
    brand: { minLength: 1, type: 'string' },
    closingBoundary: closingBoundaryProperty,
    closingDay: { maximum: 31, minimum: 1, type: 'integer' },
    dueDay: { maximum: 31, minimum: 1, type: 'integer' },
    limit: {
      maxLength: 1002,
      pattern: '^\\d+(?:\\.\\d+)?$',
      type: 'string',
    },
    name: { minLength: 1, type: 'string' },
  };
}

function createBodySchema(): SchemaObject {
  return {
    additionalProperties: false,
    properties: {
      ...settingsProperties(),
      currencyCode: { pattern: '^[A-Z]{3}$', type: 'string' },
      currencyMinorUnitScale: { maximum: 18, minimum: 0, type: 'integer' },
      paymentAccountId: { format: 'uuid', type: 'string' },
    },
    required: [
      'brand',
      'closingDay',
      'currencyCode',
      'currencyMinorUnitScale',
      'dueDay',
      'limit',
      'name',
      'paymentAccountId',
    ],
    type: 'object',
  };
}

function updateBodySchema(): SchemaObject {
  return {
    additionalProperties: false,
    properties: {
      ...settingsProperties(),
      expectedVersion: { minimum: 1, type: 'integer' },
    },
    required: [
      'brand',
      'closingBoundary',
      'closingDay',
      'dueDay',
      'expectedVersion',
      'limit',
      'name',
    ],
    type: 'object',
  };
}
