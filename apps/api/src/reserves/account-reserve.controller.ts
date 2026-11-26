import {
  AccountReserveVersionConflictError,
  GetAccountAvailabilityUseCase,
  GetOwnedAvailabilitySummaryUseCase,
  ReserveAccountNotFoundError,
  ReserveAccountUnavailableError,
  SetAccountReserveUseCase,
  type AccountAvailabilityView,
} from '@seshat/application';
import {
  AccountReserveExceedsBalanceError,
  InvalidAccountReserveError,
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
const setSchema = z.object({
  amount: z
    .string()
    .max(1002)
    .regex(/^\d+(?:\.\d+)?$/u),
  expectedVersion: z.number().int().min(0),
});

type SetRequest = z.infer<typeof setSchema>;

const money: SchemaObject = {
  properties: {
    amount: { pattern: '^-?\\d+(?:\\.\\d+)?$', type: 'string' },
    currencyCode: { pattern: '^[A-Z]{3}$', type: 'string' },
  },
  required: ['amount', 'currencyCode'],
  type: 'object',
};
const availabilityProperties: Record<string, SchemaObject> = {
  accountId: { format: 'uuid', type: 'string' },
  available: money,
  book: money,
  reserveAboveBalance: { type: 'boolean' },
  reserveVersion: { minimum: 0, type: 'integer' },
  reserved: money,
};
const availabilitySchema: SchemaObject = {
  description:
    'Book balance, declared reserve and available amount of an account, in its currency. Available = book − reserve; the book balance and net worth never change with a reserve.',
  properties: availabilityProperties,
  required: Object.keys(availabilityProperties),
  type: 'object',
};
const totalProperties: Record<string, SchemaObject> = {
  available: money,
  book: money,
  reserved: money,
};
const summarySchema: SchemaObject = {
  properties: {
    accounts: { items: availabilitySchema, type: 'array' },
    totalsByCurrency: {
      description: 'One line per currency; currencies are never added up.',
      items: {
        properties: totalProperties,
        required: Object.keys(totalProperties),
        type: 'object',
      },
      type: 'array',
    },
  },
  required: ['accounts', 'totalsByCurrency'],
  type: 'object',
};

type MoneyResponse = Readonly<{ amount: string; currencyCode: string }>;

export type AccountAvailabilityResponse = Readonly<{
  accountId: string;
  book: MoneyResponse;
  reserved: MoneyResponse;
  available: MoneyResponse;
  reserveAboveBalance: boolean;
  reserveVersion: number;
}>;

export type AvailabilitySummaryResponse = Readonly<{
  accounts: readonly AccountAvailabilityResponse[];
  totalsByCurrency: readonly Readonly<{
    book: MoneyResponse;
    reserved: MoneyResponse;
    available: MoneyResponse;
  }>[];
}>;

@Controller('accounts')
@ApiTags('accounts')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Bearer token missing or invalid' })
@UseGuards(BearerAuthGuard)
export class AccountReserveController {
  public constructor(
    @Inject(SetAccountReserveUseCase)
    private readonly setReserve: SetAccountReserveUseCase,
    @Inject(GetAccountAvailabilityUseCase)
    private readonly getAvailability: GetAccountAvailabilityUseCase,
    @Inject(GetOwnedAvailabilitySummaryUseCase)
    private readonly summary: GetOwnedAvailabilitySummaryUseCase,
    @Inject(AuthenticatedActorContext)
    private readonly actors: AuthenticatedActorContext,
  ) {}

  @Get('availability')
  @ApiOperation({
    summary:
      'Book balance, reserve and available amount per account and per currency',
  })
  @ApiOkResponse({ schema: summarySchema })
  public async availability(
    @Req() request: FastifyRequest,
  ): Promise<AvailabilitySummaryResponse> {
    const summary = await this.summary.execute(this.actorId(request));
    return {
      accounts: summary.accounts.map(mapView),
      totalsByCurrency: summary.totalsByCurrency.map((total) => ({
        available: mapMoney(total.available),
        book: mapMoney(total.book),
        reserved: mapMoney(total.reserved),
      })),
    };
  }

  @Get(':accountId/reserve')
  @ApiOperation({ summary: 'Get the reserve and availability of an account' })
  @ApiParam({ format: 'uuid', name: 'accountId', type: 'string' })
  @ApiOkResponse({ schema: availabilitySchema })
  @ApiNotFoundResponse({ description: 'Owned account not found' })
  public async get(
    @Req() request: FastifyRequest,
    @Param('accountId', new ZodValidationPipe(idSchema)) accountId: string,
  ): Promise<AccountAvailabilityResponse> {
    try {
      return mapView(
        await this.getAvailability.execute({
          accountId,
          actorId: this.actorId(request),
        }),
      );
    } catch (error) {
      throw mapError(error);
    }
  }

  @Put(':accountId/reserve')
  @ApiOperation({
    summary:
      'Create, change or remove (amount 0) the reserve of an account; nothing moves between accounts',
  })
  @ApiParam({ format: 'uuid', name: 'accountId', type: 'string' })
  @ApiHeader(idempotencyKeyHeader)
  @ApiBody({
    schema: {
      additionalProperties: false,
      properties: {
        amount: { pattern: '^\\d+(?:\\.\\d+)?$', type: 'string' },
        expectedVersion: {
          description: '0 when the account has no reserve yet',
          minimum: 0,
          type: 'integer',
        },
      },
      required: ['amount', 'expectedVersion'],
      type: 'object',
    },
  })
  @ApiOkResponse({ schema: availabilitySchema })
  @ApiBadRequestResponse({ description: 'Invalid reserve or idempotency key' })
  @ApiNotFoundResponse({ description: 'Owned account not found' })
  @ApiConflictResponse({
    description:
      'Reserve changed by another request, or idempotency key reused with a different payload',
  })
  @ApiUnprocessableEntityResponse({
    description: 'Reserve above the balance, or the account is not active',
  })
  public async set(
    @Req() request: FastifyRequest,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Param('accountId', new ZodValidationPipe(idSchema)) accountId: string,
    @Body(new ZodValidationPipe(setSchema)) body: SetRequest,
  ): Promise<AccountAvailabilityResponse> {
    const key = parseIdempotencyKeyHeader(idempotencyKey);
    try {
      return mapView(
        await this.setReserve.execute({
          accountId,
          actorId: this.actorId(request),
          amount: body.amount,
          expectedVersion: body.expectedVersion,
          idempotencyKey: key,
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

function mapView(view: AccountAvailabilityView): AccountAvailabilityResponse {
  return {
    accountId: view.accountId,
    available: mapMoney(view.availability.available),
    book: mapMoney(view.availability.book),
    reserveAboveBalance: view.availability.reserveAboveBalance,
    reserveVersion: view.reserveVersion,
    reserved: mapMoney(view.availability.reserved),
  };
}

function mapError(error: unknown): Error {
  const idempotencyError = mapIdempotencyError(error);
  if (idempotencyError !== undefined) return idempotencyError;
  if (error instanceof ReserveAccountNotFoundError) {
    return new NotFoundException('Account not found.');
  }
  if (error instanceof AccountReserveVersionConflictError) {
    return new ConflictException('The reserve was changed by another request.');
  }
  if (
    error instanceof AccountReserveExceedsBalanceError ||
    error instanceof ReserveAccountUnavailableError
  ) {
    return new UnprocessableEntityException(error.message);
  }
  if (
    error instanceof InvalidAccountReserveError ||
    error instanceof InvalidMoneyAmountError
  ) {
    return new BadRequestException('Invalid reserve request.');
  }
  return error instanceof Error ? error : new Error('Unknown reserve error.');
}
