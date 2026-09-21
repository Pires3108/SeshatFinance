import {
  ChangeOwnedTransactionLifecycleUseCase,
  CreateTransactionUseCase,
  GetOwnedTransactionUseCase,
  InvalidTransactionInstantRangeError,
  ListOwnedAccountTransactionsUseCase,
  ListOwnedTransactionsBetweenUseCase,
  OwnedTransactionNotFoundError,
  TransactionAccountUnavailableError,
  TransactionRequiresTransferMutationError,
  TransactionVersionConflictError,
  UpdateOwnedTransactionUseCase,
} from '@seshat/application';
import {
  InvalidCurrencyError,
  InvalidMoneyAmountError,
  InvalidTransactionError,
  TransactionLifecycleError,
  type Transaction,
  type TransactionSnapshot,
} from '@seshat/domain';
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
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
  ApiCreatedResponse,
  ApiConflictResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
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
  observations: z.string().trim().min(1).nullable(),
  occurredAt: z.iso.datetime({ offset: true }),
});
const updateSchema = createSchema.omit({
  currencyCode: true,
  currencyMinorUnitScale: true,
});
const lifecycleSchema = z.object({
  action: z.enum([
    'archive',
    'unarchive',
    'move-to-trash',
    'restore-from-trash',
  ]),
});
const instantRangeSchema = z.object({
  from: z.iso.datetime({ offset: true }),
  to: z.iso.datetime({ offset: true }),
});
type CreateRequest = z.infer<typeof createSchema>;
type UpdateRequest = z.infer<typeof updateSchema>;
type LifecycleRequest = z.infer<typeof lifecycleSchema>;
type InstantRangeRequest = z.infer<typeof instantRangeSchema>;
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
  observations: string | null;
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
    observations: { nullable: true, type: 'string' },
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
    'observations',
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
    @Inject(ListOwnedTransactionsBetweenUseCase)
    private readonly listTransactionsBetween: ListOwnedTransactionsBetweenUseCase,
    @Inject(UpdateOwnedTransactionUseCase)
    private readonly updateTransaction: UpdateOwnedTransactionUseCase,
    @Inject(ChangeOwnedTransactionLifecycleUseCase)
    private readonly changeLifecycle: ChangeOwnedTransactionLifecycleUseCase,
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

  @Get('transactions')
  @ApiOperation({
    summary: 'List owned transactions in an explicit instant range',
  })
  @ApiQuery({
    format: 'date-time',
    name: 'from',
    required: true,
    type: 'string',
  })
  @ApiQuery({ format: 'date-time', name: 'to', required: true, type: 'string' })
  @ApiOkResponse({ schema: { items: responseSchema, type: 'array' } })
  public async listBetween(
    @Req() request: FastifyRequest,
    @Query(new ZodValidationPipe(instantRangeSchema))
    query: InstantRangeRequest,
  ): Promise<readonly Response[]> {
    try {
      return (
        await this.listTransactionsBetween.execute(
          this.actorId(request),
          new Date(query.from),
          new Date(query.to),
        )
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

  @Patch('transactions/:transactionId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update an owned transaction' })
  @ApiParam({ format: 'uuid', name: 'transactionId', type: 'string' })
  @ApiBody({ schema: updateBodySchema() })
  @ApiOkResponse({ schema: responseSchema })
  @ApiNotFoundResponse({ description: 'Owned transaction was not found' })
  @ApiConflictResponse({
    description: 'Transaction changed concurrently or belongs to a transfer',
  })
  public async update(
    @Req() request: FastifyRequest,
    @Param('transactionId', new ZodValidationPipe(idSchema))
    transactionId: string,
    @Body(new ZodValidationPipe(updateSchema)) body: UpdateRequest,
  ): Promise<Response> {
    try {
      return mapTransaction(
        await this.updateTransaction.execute({
          actorId: this.actorId(request),
          ...body,
          occurredAt: new Date(body.occurredAt),
          transactionId,
        }),
      );
    } catch (error) {
      throw mapError(error);
    }
  }

  @Patch('transactions/:transactionId/lifecycle')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Change an owned transaction lifecycle' })
  @ApiParam({ format: 'uuid', name: 'transactionId', type: 'string' })
  @ApiBody({
    schema: {
      additionalProperties: false,
      properties: {
        action: {
          enum: ['archive', 'unarchive', 'move-to-trash', 'restore-from-trash'],
          type: 'string',
        },
      },
      required: ['action'],
      type: 'object',
    },
  })
  @ApiOkResponse({ schema: responseSchema })
  @ApiNotFoundResponse({ description: 'Owned transaction was not found' })
  @ApiConflictResponse({
    description: 'Transaction changed concurrently or belongs to a transfer',
  })
  public async lifecycle(
    @Req() request: FastifyRequest,
    @Param('transactionId', new ZodValidationPipe(idSchema))
    transactionId: string,
    @Body(new ZodValidationPipe(lifecycleSchema)) body: LifecycleRequest,
  ): Promise<Response> {
    try {
      return mapTransaction(
        await this.changeLifecycle.execute({
          action: body.action,
          actorId: this.actorId(request),
          transactionId,
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
    observations: value.observations,
    occurredAt: value.occurredAt.toISOString(),
    trashedAt: value.trashedAt?.toISOString() ?? null,
    updatedAt: value.updatedAt.toISOString(),
    version: value.version,
  };
}

function mapError(error: unknown): Error {
  if (error instanceof OwnedTransactionNotFoundError)
    return new NotFoundException('Transaction not found.');
  if (error instanceof TransactionAccountUnavailableError)
    return new NotFoundException('Account not found.');
  if (error instanceof TransactionVersionConflictError)
    return new ConflictException('Transaction was modified concurrently.');
  if (error instanceof TransactionRequiresTransferMutationError)
    return new ConflictException(
      'Transfer entries must be changed through the transfer endpoint.',
    );
  if (
    error instanceof InvalidCurrencyError ||
    error instanceof InvalidMoneyAmountError ||
    error instanceof InvalidTransactionInstantRangeError ||
    error instanceof InvalidTransactionError ||
    error instanceof TransactionLifecycleError
  )
    return new BadRequestException('Invalid transaction operation.');
  return error instanceof Error
    ? error
    : new Error('Unknown transaction error.');
}

function updateBodySchema(): SchemaObject {
  const schema = createBodySchema();
  const properties = { ...schema.properties };
  delete properties.currencyCode;
  delete properties.currencyMinorUnitScale;
  return {
    ...schema,
    properties,
    required: ['amount', 'description', 'kind', 'observations', 'occurredAt'],
  };
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
      observations: { nullable: true, type: 'string' },
      occurredAt: { format: 'date-time', type: 'string' },
    },
    required: [
      'amount',
      'currencyCode',
      'currencyMinorUnitScale',
      'description',
      'kind',
      'observations',
      'occurredAt',
    ],
    type: 'object',
  };
}
