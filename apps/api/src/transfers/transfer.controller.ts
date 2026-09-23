import {
  ChangeOwnedTransferLifecycleUseCase,
  CreateTransferUseCase,
  GetOwnedTransferUseCase,
  ListOwnedTransfersUseCase,
  OwnedTransferNotFoundError,
  TransferAccountUnavailableError,
  TransferCurrencyMismatchError,
  TransferVersionConflictError,
} from '@seshat/application';
import {
  InvalidCurrencyError,
  InvalidMoneyAmountError,
  InvalidTransferError,
  TransactionLifecycleError,
  type Transfer,
} from '@seshat/domain';
import {
  BadRequestException,
  Body,
  Controller,
  ConflictException,
  Get,
  Inject,
  NotFoundException,
  Param,
  ParseUUIDPipe,
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
  ApiOperation,
  ApiOkResponse,
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

const createSchema = z.object({
  amount: z
    .string()
    .max(1002)
    .regex(/^\d+(?:\.\d+)?$/u),
  currencyCode: z.string().regex(/^[A-Z]{3}$/u),
  currencyMinorUnitScale: z.number().int().min(0).max(18),
  description: z.string().trim().min(1).nullable(),
  destinationAccountId: z.uuid(),
  observations: z.string().trim().min(1).nullable(),
  occurredAt: z.iso.datetime({ offset: true }),
  sourceAccountId: z.uuid(),
});
const lifecycleSchema = z.object({
  action: z.enum([
    'archive',
    'unarchive',
    'move-to-trash',
    'restore-from-trash',
  ]),
});
const lifecycleFilterSchema = z.enum(['active', 'archived', 'trashed']);
type CreateRequest = z.infer<typeof createSchema>;
type LifecycleRequest = z.infer<typeof lifecycleSchema>;
type Response = Readonly<{
  amount: string;
  archivedAt: string | null;
  createdAt: string;
  currencyCode: string;
  currencyMinorUnitScale: number;
  description: string | null;
  destinationAccountId: string;
  destinationTransactionId: string;
  id: string;
  lifecycle: 'active' | 'archived' | 'trashed';
  observations: string | null;
  occurredAt: string;
  sourceAccountId: string;
  sourceTransactionId: string;
  trashedAt: string | null;
}>;

const responseSchema: SchemaObject = {
  properties: {
    amount: { pattern: '^\\d+(?:\\.\\d+)?$', type: 'string' },
    archivedAt: { format: 'date-time', nullable: true, type: 'string' },
    createdAt: { format: 'date-time', type: 'string' },
    currencyCode: { pattern: '^[A-Z]{3}$', type: 'string' },
    currencyMinorUnitScale: { maximum: 18, minimum: 0, type: 'integer' },
    description: { nullable: true, type: 'string' },
    destinationAccountId: { format: 'uuid', type: 'string' },
    destinationTransactionId: { format: 'uuid', type: 'string' },
    id: { format: 'uuid', type: 'string' },
    lifecycle: { enum: ['active', 'archived', 'trashed'], type: 'string' },
    observations: { nullable: true, type: 'string' },
    occurredAt: { format: 'date-time', type: 'string' },
    sourceAccountId: { format: 'uuid', type: 'string' },
    sourceTransactionId: { format: 'uuid', type: 'string' },
    trashedAt: { format: 'date-time', nullable: true, type: 'string' },
  },
  required: [
    'amount',
    'archivedAt',
    'createdAt',
    'currencyCode',
    'currencyMinorUnitScale',
    'description',
    'destinationAccountId',
    'destinationTransactionId',
    'id',
    'lifecycle',
    'observations',
    'occurredAt',
    'sourceAccountId',
    'sourceTransactionId',
    'trashedAt',
  ],
  type: 'object',
};

@Controller('transfers')
@ApiTags('transfers')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Bearer token missing or invalid' })
@UseGuards(BearerAuthGuard)
export class TransferController {
  public constructor(
    @Inject(CreateTransferUseCase)
    private readonly createTransfer: CreateTransferUseCase,
    @Inject(GetOwnedTransferUseCase)
    private readonly getTransfer: GetOwnedTransferUseCase,
    @Inject(ListOwnedTransfersUseCase)
    private readonly listTransfers: ListOwnedTransfersUseCase,
    @Inject(ChangeOwnedTransferLifecycleUseCase)
    private readonly changeLifecycle: ChangeOwnedTransferLifecycleUseCase,
    @Inject(AuthenticatedActorContext)
    private readonly actors: AuthenticatedActorContext,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List transfers owned by the authenticated user' })
  @ApiQuery({
    enum: ['active', 'archived', 'trashed'],
    name: 'lifecycle',
    required: false,
  })
  @ApiOkResponse({ schema: { items: responseSchema, type: 'array' } })
  public async list(
    @Req() request: FastifyRequest,
    @Query('lifecycle', new ZodValidationPipe(lifecycleFilterSchema.optional()))
    lifecycle?: z.infer<typeof lifecycleFilterSchema>,
  ): Promise<readonly Response[]> {
    return (
      await this.listTransfers.execute(this.actorId(request), lifecycle)
    ).map(mapTransfer);
  }

  @Get(':transferId')
  @ApiOperation({ summary: 'Get an owned transfer pair' })
  @ApiParam({ format: 'uuid', name: 'transferId', type: 'string' })
  @ApiOkResponse({ schema: responseSchema })
  @ApiNotFoundResponse({ description: 'Owned transfer not found' })
  public async get(
    @Req() request: FastifyRequest,
    @Param('transferId', new ParseUUIDPipe({ version: '4' }))
    transferId: string,
  ): Promise<Response> {
    const transfer = await this.getTransfer.execute(
      transferId,
      this.actorId(request),
    );
    if (transfer === null) throw new NotFoundException('Transfer not found.');
    return mapTransfer(transfer);
  }

  @Post()
  @ApiOperation({
    summary: 'Record a transfer declared by the authenticated user',
  })
  @ApiBody({ schema: createBodySchema() })
  @ApiCreatedResponse({ schema: responseSchema })
  @ApiNotFoundResponse({ description: 'An owned active account was not found' })
  public async create(
    @Req() request: FastifyRequest,
    @Body(new ZodValidationPipe(createSchema)) body: CreateRequest,
  ): Promise<Response> {
    try {
      return mapTransfer(
        await this.createTransfer.execute({
          actorId: this.actorId(request),
          ...body,
          occurredAt: new Date(body.occurredAt),
        }),
      );
    } catch (error) {
      throw mapError(error);
    }
  }

  @Patch(':transferId/lifecycle')
  @ApiOperation({ summary: 'Change an owned transfer pair lifecycle' })
  @ApiParam({ format: 'uuid', name: 'transferId', type: 'string' })
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
  @ApiNotFoundResponse({ description: 'Owned transfer not found' })
  @ApiConflictResponse({ description: 'Transfer changed concurrently' })
  public async lifecycle(
    @Req() request: FastifyRequest,
    @Param('transferId', new ParseUUIDPipe({ version: '4' }))
    transferId: string,
    @Body(new ZodValidationPipe(lifecycleSchema)) body: LifecycleRequest,
  ): Promise<Response> {
    try {
      return mapTransfer(
        await this.changeLifecycle.execute({
          action: body.action,
          actorId: this.actorId(request),
          transferId,
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

function mapTransfer(transfer: Transfer): Response {
  const value = transfer.toSnapshot();
  return {
    amount: value.source.amount.amount,
    archivedAt: value.source.archivedAt?.toISOString() ?? null,
    createdAt: value.source.createdAt.toISOString(),
    currencyCode: value.source.amount.currency.code,
    currencyMinorUnitScale: value.source.amount.currency.minorUnitScale,
    description: value.source.description,
    destinationAccountId: value.destination.accountId,
    destinationTransactionId: value.destination.id,
    id: value.id,
    lifecycle: value.source.lifecycle,
    observations: value.source.observations,
    occurredAt: value.source.occurredAt.toISOString(),
    sourceAccountId: value.source.accountId,
    sourceTransactionId: value.source.id,
    trashedAt: value.source.trashedAt?.toISOString() ?? null,
  };
}

function mapError(error: unknown): Error {
  if (error instanceof OwnedTransferNotFoundError) {
    return new NotFoundException('Transfer not found.');
  }
  if (error instanceof TransferVersionConflictError) {
    return new ConflictException('Transfer changed concurrently.');
  }
  if (error instanceof TransferAccountUnavailableError) {
    return new NotFoundException('Account not found.');
  }
  if (
    error instanceof InvalidCurrencyError ||
    error instanceof InvalidMoneyAmountError ||
    error instanceof InvalidTransferError ||
    error instanceof TransactionLifecycleError ||
    error instanceof TransferCurrencyMismatchError
  ) {
    return new BadRequestException('Invalid transfer operation.');
  }
  return error instanceof Error ? error : new Error('Unknown transfer error.');
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
      destinationAccountId: { format: 'uuid', type: 'string' },
      observations: { nullable: true, type: 'string' },
      occurredAt: { format: 'date-time', type: 'string' },
      sourceAccountId: { format: 'uuid', type: 'string' },
    },
    required: [
      'amount',
      'currencyCode',
      'currencyMinorUnitScale',
      'description',
      'destinationAccountId',
      'observations',
      'occurredAt',
      'sourceAccountId',
    ],
    type: 'object',
  };
}
