import {
  CreateCreditCardUseCase,
  CreditCardCurrencyMismatchError,
  CreditCardPaymentAccountUnavailableError,
} from '@seshat/application';
import {
  InvalidCreditCardError,
  InvalidCurrencyError,
  InvalidMoneyAmountError,
  type CreditCard,
} from '@seshat/domain';
import {
  BadRequestException,
  Body,
  Controller,
  Inject,
  NotFoundException,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
  type SchemaObject,
} from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';

import { AuthenticatedActorContext } from '../auth/authenticated-actor-context.js';
import { BearerAuthGuard } from '../auth/bearer-auth.guard.js';
import { ZodValidationPipe } from '../platform/zod-validation.pipe.js';

const createSchema = z.object({
  brand: z.string().trim().min(1),
  closingDay: z.number().int().min(1).max(31),
  currencyCode: z.string().regex(/^[A-Z]{3}$/u),
  currencyMinorUnitScale: z.number().int().min(0).max(18),
  dueDay: z.number().int().min(1).max(31),
  limit: z
    .string()
    .max(1002)
    .regex(/^\d+(?:\.\d+)?$/u),
  name: z.string().trim().min(1),
  paymentAccountId: z.uuid(),
});

type CreateRequest = z.infer<typeof createSchema>;
type Response = Readonly<{
  brand: string;
  closingDay: number;
  createdAt: string;
  currencyCode: string;
  currencyMinorUnitScale: number;
  dueDay: number;
  id: string;
  limit: string;
  name: string;
  paymentAccountId: string;
}>;

const responseSchema: SchemaObject = {
  properties: {
    brand: { type: 'string' },
    closingDay: { maximum: 31, minimum: 1, type: 'integer' },
    createdAt: { format: 'date-time', type: 'string' },
    currencyCode: { pattern: '^[A-Z]{3}$', type: 'string' },
    currencyMinorUnitScale: { maximum: 18, minimum: 0, type: 'integer' },
    dueDay: { maximum: 31, minimum: 1, type: 'integer' },
    id: { format: 'uuid', type: 'string' },
    limit: { pattern: '^\\d+(?:\\.\\d+)?$', type: 'string' },
    name: { type: 'string' },
    paymentAccountId: { format: 'uuid', type: 'string' },
  },
  required: [
    'brand',
    'closingDay',
    'createdAt',
    'currencyCode',
    'currencyMinorUnitScale',
    'dueDay',
    'id',
    'limit',
    'name',
    'paymentAccountId',
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
    closingDay: value.closingDay,
    createdAt: value.createdAt.toISOString(),
    currencyCode: value.limit.currency.code,
    currencyMinorUnitScale: value.limit.currency.minorUnitScale,
    dueDay: value.dueDay,
    id: value.id,
    limit: value.limit.amount,
    name: value.name,
    paymentAccountId: value.paymentAccountId,
  };
}

function mapError(error: unknown): Error {
  if (error instanceof CreditCardPaymentAccountUnavailableError) {
    return new NotFoundException('Payment account not found.');
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

function createBodySchema(): SchemaObject {
  return {
    additionalProperties: false,
    properties: {
      brand: { minLength: 1, type: 'string' },
      closingDay: { maximum: 31, minimum: 1, type: 'integer' },
      currencyCode: { pattern: '^[A-Z]{3}$', type: 'string' },
      currencyMinorUnitScale: { maximum: 18, minimum: 0, type: 'integer' },
      dueDay: { maximum: 31, minimum: 1, type: 'integer' },
      limit: {
        maxLength: 1002,
        pattern: '^\\d+(?:\\.\\d+)?$',
        type: 'string',
      },
      name: { minLength: 1, type: 'string' },
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
