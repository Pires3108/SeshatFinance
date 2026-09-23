import {
  BalanceAdjustmentAccountUnavailableError,
  BalanceAdjustmentBalanceConflictError,
  CreateBalanceAdjustmentUseCase,
  ListOwnedBalanceAdjustmentsUseCase,
  OwnedAccountNotFoundError,
  type BalanceAdjustmentHistoryItem,
} from '@seshat/application';
import {
  CurrencyMismatchError,
  InvalidBalanceAdjustmentError,
  InvalidMoneyAmountError,
  type BalanceAdjustment,
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
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
  type SchemaObject,
} from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';

import { AuthenticatedActorContext } from '../auth/authenticated-actor-context.js';
import { BearerAuthGuard } from '../auth/bearer-auth.guard.js';
import { ZodValidationPipe } from '../platform/zod-validation.pipe.js';

const idSchema = z.uuid();
const createSchema = z.object({
  justification: z.string().trim().min(1),
  occurredAt: z.iso.datetime({ offset: true }),
  reportedBalance: z
    .string()
    .max(1003)
    .regex(/^-?\d+(?:\.\d+)?$/u),
});
type CreateRequest = z.infer<typeof createSchema>;
type Response = Readonly<{
  accountId: string;
  createdAt: string;
  currencyCode: string;
  currencyMinorUnitScale: number;
  difference: string;
  id: string;
  justification: string;
  occurredAt: string;
  previousBalance: string;
  reportedBalance: string;
  transactionId: string;
  transactionKind: 'income' | 'expense';
}>;

const responseSchema: SchemaObject = {
  properties: {
    accountId: { format: 'uuid', type: 'string' },
    createdAt: { format: 'date-time', type: 'string' },
    currencyCode: { pattern: '^[A-Z]{3}$', type: 'string' },
    currencyMinorUnitScale: { maximum: 18, minimum: 0, type: 'integer' },
    difference: { pattern: '^-?\\d+(?:\\.\\d+)?$', type: 'string' },
    id: { format: 'uuid', type: 'string' },
    justification: { type: 'string' },
    occurredAt: { format: 'date-time', type: 'string' },
    previousBalance: { pattern: '^-?\\d+(?:\\.\\d+)?$', type: 'string' },
    reportedBalance: { pattern: '^-?\\d+(?:\\.\\d+)?$', type: 'string' },
    transactionId: { format: 'uuid', type: 'string' },
    transactionKind: { enum: ['income', 'expense'], type: 'string' },
  },
  required: [
    'accountId',
    'createdAt',
    'currencyCode',
    'currencyMinorUnitScale',
    'difference',
    'id',
    'justification',
    'occurredAt',
    'previousBalance',
    'reportedBalance',
    'transactionId',
    'transactionKind',
  ],
  type: 'object',
};

@Controller('accounts/:accountId/balance-adjustments')
@ApiTags('accounts')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Bearer token missing or invalid' })
@UseGuards(BearerAuthGuard)
export class BalanceAdjustmentController {
  public constructor(
    @Inject(CreateBalanceAdjustmentUseCase)
    private readonly createAdjustment: CreateBalanceAdjustmentUseCase,
    @Inject(ListOwnedBalanceAdjustmentsUseCase)
    private readonly listAdjustments: ListOwnedBalanceAdjustmentsUseCase,
    @Inject(AuthenticatedActorContext)
    private readonly actors: AuthenticatedActorContext,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'List the reconciliation history of an owned account',
  })
  @ApiParam({ format: 'uuid', name: 'accountId', type: 'string' })
  @ApiOkResponse({ schema: { items: responseSchema, type: 'array' } })
  @ApiNotFoundResponse({ description: 'Owned account was not found' })
  public async list(
    @Req() request: FastifyRequest,
    @Param('accountId', new ZodValidationPipe(idSchema)) accountId: string,
  ): Promise<readonly Response[]> {
    try {
      const items = await this.listAdjustments.execute(
        accountId,
        this.actorId(request),
      );
      return items.map(mapHistoryItem);
    } catch (error) {
      throw mapError(error);
    }
  }

  @Post()
  @ApiOperation({
    summary: 'Reconcile an owned account to a user-reported balance',
  })
  @ApiParam({ format: 'uuid', name: 'accountId', type: 'string' })
  @ApiBody({ schema: createBodySchema() })
  @ApiCreatedResponse({ schema: responseSchema })
  @ApiNotFoundResponse({ description: 'Owned active account was not found' })
  @ApiConflictResponse({ description: 'Account balance changed concurrently' })
  public async create(
    @Req() request: FastifyRequest,
    @Param('accountId', new ZodValidationPipe(idSchema)) accountId: string,
    @Body(new ZodValidationPipe(createSchema)) body: CreateRequest,
  ): Promise<Response> {
    try {
      return mapAdjustment(
        await this.createAdjustment.execute({
          accountId,
          actorId: this.actorId(request),
          justification: body.justification,
          occurredAt: new Date(body.occurredAt),
          reportedBalance: body.reportedBalance,
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

function mapAdjustment(adjustment: BalanceAdjustment): Response {
  const value = adjustment.toSnapshot();
  return {
    accountId: value.transaction.accountId,
    createdAt: value.transaction.createdAt.toISOString(),
    currencyCode: value.difference.currency.code,
    currencyMinorUnitScale: value.difference.currency.minorUnitScale,
    difference: value.difference.amount,
    id: value.id,
    justification: value.justification,
    occurredAt: value.transaction.occurredAt.toISOString(),
    previousBalance: value.previousBalance.amount,
    reportedBalance: value.reportedBalance.amount,
    transactionId: value.transaction.id,
    transactionKind: value.transaction.kind,
  };
}

function mapHistoryItem(item: BalanceAdjustmentHistoryItem): Response {
  return {
    accountId: item.accountId,
    createdAt: item.createdAt.toISOString(),
    currencyCode: item.difference.currency.code,
    currencyMinorUnitScale: item.difference.currency.minorUnitScale,
    difference: item.difference.toDecimal(),
    id: item.id,
    justification: item.justification,
    occurredAt: item.occurredAt.toISOString(),
    previousBalance: item.previousBalance.toDecimal(),
    reportedBalance: item.reportedBalance.toDecimal(),
    transactionId: item.transactionId,
    transactionKind: item.transactionKind,
  };
}

function mapError(error: unknown): Error {
  if (error instanceof BalanceAdjustmentAccountUnavailableError) {
    return new NotFoundException('Account not found.');
  }
  if (error instanceof OwnedAccountNotFoundError) {
    return new NotFoundException('Account not found.');
  }
  if (error instanceof BalanceAdjustmentBalanceConflictError) {
    return new ConflictException('Account balance changed concurrently.');
  }
  if (
    error instanceof CurrencyMismatchError ||
    error instanceof InvalidBalanceAdjustmentError ||
    error instanceof InvalidMoneyAmountError
  ) {
    return new BadRequestException('Invalid balance adjustment operation.');
  }
  return error instanceof Error
    ? error
    : new Error('Unknown balance adjustment error.');
}

function createBodySchema(): SchemaObject {
  return {
    additionalProperties: false,
    properties: {
      justification: { minLength: 1, type: 'string' },
      occurredAt: { format: 'date-time', type: 'string' },
      reportedBalance: {
        maxLength: 1003,
        pattern: '^-?\\d+(?:\\.\\d+)?$',
        type: 'string',
      },
    },
    required: ['justification', 'occurredAt', 'reportedBalance'],
    type: 'object',
  };
}
