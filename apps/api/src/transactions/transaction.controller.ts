import {
  CreateTransactionUseCase,
  GetOwnedTransactionUseCase,
  ListOwnedAccountTransactionsUseCase,
  TransactionAccountUnavailableError,
} from '@seshat/application';
import {
  InvalidCurrencyError,
  InvalidMoneyAmountError,
  InvalidTransactionError,
  type Transaction,
  type TransactionSnapshot,
} from '@seshat/domain';
import {
  BadRequestException,
  Body,
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
  amount: z
    .string()
    .max(1002)
    .regex(/^\d+(?:\.\d+)?$/u),
  currencyCode: z.string().regex(/^[A-Z]{3}$/u),
  currencyMinorUnitScale: z.number().int().min(0).max(18),
  description: z.string().trim().min(1).nullable(),
  kind: z.enum(['income', 'expense']),
  occurredAt: z.iso.datetime({ offset: true }),
});
type CreateRequest = z.infer<typeof createSchema>;
type Response = Readonly<{
  accountId: string;
  amount: string;
  archivedAt: string | null;
  createdAt: string;
  currencyCode: string;
  currencyMinorUnitScale: number;
  description: string | null;
  id: string;
  kind: TransactionSnapshot['kind'];
  lifecycle: TransactionSnapshot['lifecycle'];
  occurredAt: string;
  trashedAt: string | null;
  updatedAt: string;
  version: number;
}>;

const responseSchema: SchemaObject = {
  properties: {
    accountId: { format: 'uuid', type: 'string' },
    amount: { pattern: '^\\d+(?:\\.\\d+)?$', type: 'string' },
    archivedAt: { format: 'date-time', nullable: true, type: 'string' },
    createdAt: { format: 'date-time', type: 'string' },
    currencyCode: { pattern: '^[A-Z]{3}$', type: 'string' },
    currencyMinorUnitScale: { maximum: 18, minimum: 0, type: 'integer' },
    description: { nullable: true, type: 'string' },
    id: { format: 'uuid', type: 'string' },
    kind: { enum: ['income', 'expense'], type: 'string' },
    lifecycle: { enum: ['active', 'archived', 'trashed'], type: 'string' },
    occurredAt: { format: 'date-time', type: 'string' },
    trashedAt: { format: 'date-time', nullable: true, type: 'string' },
    updatedAt: { format: 'date-time', type: 'string' },
    version: { minimum: 1, type: 'integer' },
  },
  required: [
    'accountId',
    'amount',
    'archivedAt',
    'createdAt',
    'currencyCode',
    'currencyMinorUnitScale',
    'description',
    'id',
    'kind',
    'lifecycle',
    'occurredAt',
    'trashedAt',
    'updatedAt',
    'version',
  ],
  type: 'object',
};

@Controller()
@ApiTags('transactions')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Bearer token missing or invalid' })
@UseGuards(BearerAuthGuard)
export class TransactionController {
  public constructor(
    @Inject(CreateTransactionUseCase)
    private readonly createTransaction: CreateTransactionUseCase,
    @Inject(GetOwnedTransactionUseCase)
    private readonly getTransaction: GetOwnedTransactionUseCase,
    @Inject(ListOwnedAccountTransactionsUseCase)
    private readonly listTransactions: ListOwnedAccountTransactionsUseCase,
    @Inject(AuthenticatedActorContext)
    private readonly actors: AuthenticatedActorContext,
  ) {}

  @Post('accounts/:accountId/transactions')
  @ApiOperation({
    summary: 'Record an income or expense declared by the authenticated user',
  })
  @ApiParam({ format: 'uuid', name: 'accountId', type: 'string' })
  @ApiBody({ schema: createBodySchema() })
  @ApiCreatedResponse({ schema: responseSchema })
  public async create(
    @Req() request: FastifyRequest,
    @Param('accountId', new ZodValidationPipe(idSchema)) accountId: string,
    @Body(new ZodValidationPipe(createSchema)) body: CreateRequest,
  ): Promise<Response> {
    try {
      return mapTransaction(
        await this.createTransaction.execute({
          accountId,
          actorId: this.actorId(request),
          ...body,
          occurredAt: new Date(body.occurredAt),
        }),
      );
    } catch (error) {
      throw mapError(error);
    }
  }

  @Get('accounts/:accountId/transactions')
  @ApiOperation({ summary: 'List transactions for an owned account' })
  @ApiParam({ format: 'uuid', name: 'accountId', type: 'string' })
  @ApiOkResponse({ schema: { items: responseSchema, type: 'array' } })
  public async list(
    @Req() request: FastifyRequest,
    @Param('accountId', new ZodValidationPipe(idSchema)) accountId: string,
  ): Promise<readonly Response[]> {
    try {
      return (
        await this.listTransactions.execute(accountId, this.actorId(request))
      ).map(mapTransaction);
    } catch (error) {
      throw mapError(error);
    }
  }

  @Get('transactions/:transactionId')
  @ApiOperation({
    summary: 'Get a transaction owned by the authenticated user',
  })
  @ApiParam({ format: 'uuid', name: 'transactionId', type: 'string' })
  @ApiOkResponse({ schema: responseSchema })
  @ApiNotFoundResponse({ description: 'Owned transaction was not found' })
  public async get(
    @Req() request: FastifyRequest,
    @Param('transactionId', new ZodValidationPipe(idSchema))
    transactionId: string,
  ): Promise<Response> {
    const transaction = await this.getTransaction.execute(
      transactionId,
      this.actorId(request),
    );
    if (transaction === null)
      throw new NotFoundException('Transaction not found.');
    return mapTransaction(transaction);
  }

  private actorId(request: FastifyRequest): string {
    const actor = this.actors.get(request);
    if (actor === undefined) throw new UnauthorizedException();
    return actor.id;
  }
}

function mapTransaction(transaction: Transaction): Response {
  const value = transaction.toSnapshot();
  return {
    accountId: value.accountId,
    amount: value.amount.amount,
    archivedAt: value.archivedAt?.toISOString() ?? null,
    createdAt: value.createdAt.toISOString(),
    currencyCode: value.amount.currency.code,
    currencyMinorUnitScale: value.amount.currency.minorUnitScale,
    description: value.description,
    id: value.id,
    kind: value.kind,
    lifecycle: value.lifecycle,
    occurredAt: value.occurredAt.toISOString(),
    trashedAt: value.trashedAt?.toISOString() ?? null,
    updatedAt: value.updatedAt.toISOString(),
    version: value.version,
  };
}

function mapError(error: unknown): Error {
  if (error instanceof TransactionAccountUnavailableError)
    return new NotFoundException('Account not found.');
  if (
    error instanceof InvalidCurrencyError ||
    error instanceof InvalidMoneyAmountError ||
    error instanceof InvalidTransactionError
  )
    return new BadRequestException('Invalid transaction operation.');
  return error instanceof Error
    ? error
    : new Error('Unknown transaction error.');
}

function createBodySchema(): SchemaObject {
  return {
    additionalProperties: false,
    properties: {
      amount: {
        maxLength: 1002,
        pattern: '^\\d+(?:\\.\\d+)?$',
        type: 'string',
      },
      currencyCode: { pattern: '^[A-Z]{3}$', type: 'string' },
      currencyMinorUnitScale: { maximum: 18, minimum: 0, type: 'integer' },
      description: { nullable: true, type: 'string' },
      kind: { enum: ['income', 'expense'], type: 'string' },
      occurredAt: { format: 'date-time', type: 'string' },
    },
    required: [
      'amount',
      'currencyCode',
      'currencyMinorUnitScale',
      'description',
      'kind',
      'occurredAt',
    ],
    type: 'object',
  };
}
