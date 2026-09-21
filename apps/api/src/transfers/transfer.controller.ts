import {
  CreateTransferUseCase,
  TransferAccountUnavailableError,
  TransferCurrencyMismatchError,
} from '@seshat/application';
import {
  InvalidCurrencyError,
  InvalidMoneyAmountError,
  InvalidTransferError,
  type Transfer,
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
type CreateRequest = z.infer<typeof createSchema>;
type Response = Readonly<{
  amount: string;
  createdAt: string;
  currencyCode: string;
  currencyMinorUnitScale: number;
  description: string | null;
  destinationAccountId: string;
  destinationTransactionId: string;
  id: string;
  observations: string | null;
  occurredAt: string;
  sourceAccountId: string;
  sourceTransactionId: string;
}>;

const responseSchema: SchemaObject = {
  properties: {
    amount: { pattern: '^\\d+(?:\\.\\d+)?$', type: 'string' },
    createdAt: { format: 'date-time', type: 'string' },
    currencyCode: { pattern: '^[A-Z]{3}$', type: 'string' },
    currencyMinorUnitScale: { maximum: 18, minimum: 0, type: 'integer' },
    description: { nullable: true, type: 'string' },
    destinationAccountId: { format: 'uuid', type: 'string' },
    destinationTransactionId: { format: 'uuid', type: 'string' },
    id: { format: 'uuid', type: 'string' },
    observations: { nullable: true, type: 'string' },
    occurredAt: { format: 'date-time', type: 'string' },
    sourceAccountId: { format: 'uuid', type: 'string' },
    sourceTransactionId: { format: 'uuid', type: 'string' },
  },
  required: [
    'amount',
    'createdAt',
    'currencyCode',
    'currencyMinorUnitScale',
    'description',
    'destinationAccountId',
    'destinationTransactionId',
    'id',
    'observations',
    'occurredAt',
    'sourceAccountId',
    'sourceTransactionId',
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
    @Inject(AuthenticatedActorContext)
    private readonly actors: AuthenticatedActorContext,
  ) {}

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
    createdAt: value.source.createdAt.toISOString(),
    currencyCode: value.source.amount.currency.code,
    currencyMinorUnitScale: value.source.amount.currency.minorUnitScale,
    description: value.source.description,
    destinationAccountId: value.destination.accountId,
    destinationTransactionId: value.destination.id,
    id: value.id,
    observations: value.source.observations,
    occurredAt: value.source.occurredAt.toISOString(),
    sourceAccountId: value.source.accountId,
    sourceTransactionId: value.source.id,
  };
}

function mapError(error: unknown): Error {
  if (error instanceof TransferAccountUnavailableError) {
    return new NotFoundException('Account not found.');
  }
  if (
    error instanceof InvalidCurrencyError ||
    error instanceof InvalidMoneyAmountError ||
    error instanceof InvalidTransferError ||
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
