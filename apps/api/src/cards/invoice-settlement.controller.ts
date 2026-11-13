import {
  CardInvoiceNotFoundError,
  CreditCardNotFoundError,
  DeclareInvoiceSettlementUseCase,
  InvoiceSettlementAccountUnavailableError,
  InvoiceSettlementCurrencyMismatchError,
  InvoiceSettlementExceedsRemainingError,
} from '@seshat/application';
import {
  InvalidCivilDateError,
  InvalidCurrencyError,
  InvalidInvoiceSettlementError,
  InvalidMoneyAmountError,
  type InvoiceSettlement,
} from '@seshat/domain';
import {
  BadRequestException,
  Body,
  Controller,
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

const cardIdSchema = z.uuid();
const closesOnSchema = z.iso.date();
const createSchema = z.object({
  accountId: z.uuid(),
  amount: z
    .string()
    .max(1002)
    .regex(/^\d+(?:\.\d+)?$/u),
  currencyCode: z.string().regex(/^[A-Z]{3}$/u),
  currencyMinorUnitScale: z.number().int().min(0).max(18),
  paidAt: z.iso.datetime({ offset: true }),
});

type CreateRequest = z.infer<typeof createSchema>;
export type SettlementResponse = Readonly<{
  accountId: string;
  amount: string;
  cardId: string;
  createdAt: string;
  currencyCode: string;
  currencyMinorUnitScale: number;
  id: string;
  invoiceClosesOn: string;
  paidAt: string;
  transactionId: string;
}>;

const decimal = { pattern: '^\\d+(?:\\.\\d+)?$', type: 'string' } as const;
export const settlementSchema: SchemaObject = {
  description:
    'A payment the holder declares to have made outside Seshat Finance. It reduces the paying account and the invoice obligation by the same amount and creates no expense.',
  properties: {
    accountId: { format: 'uuid', type: 'string' },
    amount: decimal,
    cardId: { format: 'uuid', type: 'string' },
    createdAt: { format: 'date-time', type: 'string' },
    currencyCode: { pattern: '^[A-Z]{3}$', type: 'string' },
    currencyMinorUnitScale: { maximum: 18, minimum: 0, type: 'integer' },
    id: { format: 'uuid', type: 'string' },
    invoiceClosesOn: { format: 'date', type: 'string' },
    paidAt: { format: 'date-time', type: 'string' },
    transactionId: {
      description: 'Account movement that carries the balance effect.',
      format: 'uuid',
      type: 'string',
    },
  },
  required: [
    'accountId',
    'amount',
    'cardId',
    'createdAt',
    'currencyCode',
    'currencyMinorUnitScale',
    'id',
    'invoiceClosesOn',
    'paidAt',
    'transactionId',
  ],
  type: 'object',
};

@Controller('credit-cards/:cardId/invoices/:closesOn/settlements')
@ApiTags('credit-cards')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Bearer token missing or invalid' })
@UseGuards(BearerAuthGuard)
export class InvoiceSettlementController {
  public constructor(
    @Inject(DeclareInvoiceSettlementUseCase)
    private readonly declare: DeclareInvoiceSettlementUseCase,
    @Inject(AuthenticatedActorContext)
    private readonly actors: AuthenticatedActorContext,
  ) {}

  @Post()
  @ApiOperation({
    summary:
      'Record a payment of the invoice already made outside Seshat Finance',
  })
  @ApiParam({ format: 'uuid', name: 'cardId', type: 'string' })
  @ApiParam({ format: 'date', name: 'closesOn', type: 'string' })
  @ApiHeader(idempotencyKeyHeader)
  @ApiBody({
    schema: {
      additionalProperties: false,
      properties: {
        accountId: { format: 'uuid', type: 'string' },
        amount: decimal,
        currencyCode: { pattern: '^[A-Z]{3}$', type: 'string' },
        currencyMinorUnitScale: { maximum: 18, minimum: 0, type: 'integer' },
        paidAt: { format: 'date-time', type: 'string' },
      },
      required: [
        'accountId',
        'amount',
        'currencyCode',
        'currencyMinorUnitScale',
        'paidAt',
      ],
      type: 'object',
    },
  })
  @ApiCreatedResponse({ schema: settlementSchema })
  @ApiBadRequestResponse({ description: 'Invalid request or idempotency key' })
  @ApiNotFoundResponse({
    description: 'Owned card, account or invoice not found',
  })
  @ApiConflictResponse({
    description:
      'Idempotency key reused with a different payload or still in progress',
  })
  @ApiUnprocessableEntityResponse({
    description:
      'Currency differs from the card or account, or the amount is above the remaining obligation',
  })
  public async create(
    @Req() request: FastifyRequest,
    @Param('cardId', new ZodValidationPipe(cardIdSchema)) cardId: string,
    @Param('closesOn', new ZodValidationPipe(closesOnSchema)) closesOn: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body(new ZodValidationPipe(createSchema)) body: CreateRequest,
  ): Promise<SettlementResponse> {
    const key = parseIdempotencyKeyHeader(idempotencyKey);
    try {
      return mapSettlement(
        await this.declare.execute({
          ...body,
          actorId: this.actorId(request),
          cardId,
          idempotencyKey: key,
          invoiceClosesOn: closesOn,
          paidAt: new Date(body.paidAt),
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

export function mapSettlement(
  settlement: InvoiceSettlement,
): SettlementResponse {
  const value = settlement.toSnapshot();
  return {
    accountId: value.accountId,
    amount: value.amount.amount,
    cardId: value.cardId,
    createdAt: value.createdAt.toISOString(),
    currencyCode: value.amount.currency.code,
    currencyMinorUnitScale: value.amount.currency.minorUnitScale,
    id: value.id,
    invoiceClosesOn: value.invoiceClosesOn,
    paidAt: value.paidAt.toISOString(),
    transactionId: value.transactionId,
  };
}

function mapError(error: unknown): Error {
  const idempotencyError = mapIdempotencyError(error);
  if (idempotencyError !== undefined) return idempotencyError;
  if (
    error instanceof CreditCardNotFoundError ||
    error instanceof CardInvoiceNotFoundError ||
    error instanceof InvoiceSettlementAccountUnavailableError
  ) {
    return new NotFoundException('Card, account or invoice not found.');
  }
  if (
    error instanceof InvoiceSettlementCurrencyMismatchError ||
    error instanceof InvoiceSettlementExceedsRemainingError
  ) {
    return new UnprocessableEntityException(
      'Settlement cannot be applied to this invoice.',
    );
  }
  if (
    error instanceof InvalidInvoiceSettlementError ||
    error instanceof InvalidCurrencyError ||
    error instanceof InvalidMoneyAmountError ||
    error instanceof InvalidCivilDateError
  ) {
    return new BadRequestException('Invalid settlement.');
  }
  return error instanceof Error
    ? error
    : new Error('Unknown settlement error.');
}
