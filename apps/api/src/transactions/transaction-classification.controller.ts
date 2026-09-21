import {
  GetOwnedTransactionClassificationUseCase,
  InvalidOwnedTransactionClassificationError,
  InvalidSubcategorySelectionError,
  OwnedTransactionNotFoundError,
  SetOwnedTransactionClassificationUseCase,
  type TransactionClassificationSelection,
} from '@seshat/application';
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Put,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
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
const selectionSchema = z.object({
  categoryId: idSchema.nullable(),
  costCenterId: idSchema.nullable(),
  subcategoryId: idSchema.nullable(),
});
type SelectionRequest = z.infer<typeof selectionSchema>;

const responseSchema: SchemaObject = {
  additionalProperties: false,
  properties: {
    categoryId: { format: 'uuid', nullable: true, type: 'string' },
    costCenterId: { format: 'uuid', nullable: true, type: 'string' },
    subcategoryId: { format: 'uuid', nullable: true, type: 'string' },
  },
  required: ['categoryId', 'costCenterId', 'subcategoryId'],
  type: 'object',
};

@Controller('transactions/:transactionId/classification')
@ApiTags('transactions')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Bearer token missing or invalid' })
@UseGuards(BearerAuthGuard)
export class TransactionClassificationController {
  public constructor(
    @Inject(GetOwnedTransactionClassificationUseCase)
    private readonly getClassification: GetOwnedTransactionClassificationUseCase,
    @Inject(SetOwnedTransactionClassificationUseCase)
    private readonly setClassification: SetOwnedTransactionClassificationUseCase,
    @Inject(AuthenticatedActorContext)
    private readonly actors: AuthenticatedActorContext,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Get the classification of an owned transaction' })
  @ApiParam({ format: 'uuid', name: 'transactionId', type: 'string' })
  @ApiOkResponse({ schema: responseSchema })
  @ApiNotFoundResponse({ description: 'Owned transaction was not found' })
  public async get(
    @Req() request: FastifyRequest,
    @Param('transactionId', new ZodValidationPipe(idSchema))
    transactionId: string,
  ): Promise<TransactionClassificationSelection> {
    try {
      return await this.getClassification.execute(
        transactionId,
        this.actorId(request),
      );
    } catch (error) {
      throw mapError(error);
    }
  }

  @Put()
  @ApiOperation({
    summary: 'Replace the classification of an owned transaction',
  })
  @ApiParam({ format: 'uuid', name: 'transactionId', type: 'string' })
  @ApiBody({ schema: responseSchema })
  @ApiOkResponse({ schema: responseSchema })
  @ApiBadRequestResponse({
    description:
      'A selected classification is invalid or not owned by the actor',
  })
  @ApiNotFoundResponse({ description: 'Owned transaction was not found' })
  public async replace(
    @Req() request: FastifyRequest,
    @Param('transactionId', new ZodValidationPipe(idSchema))
    transactionId: string,
    @Body(new ZodValidationPipe(selectionSchema)) body: SelectionRequest,
  ): Promise<TransactionClassificationSelection> {
    try {
      return await this.setClassification.execute({
        actorId: this.actorId(request),
        ...body,
        transactionId,
      });
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

function mapError(error: unknown): Error {
  if (error instanceof OwnedTransactionNotFoundError) {
    return new NotFoundException('Transaction not found.');
  }
  if (
    error instanceof InvalidOwnedTransactionClassificationError ||
    error instanceof InvalidSubcategorySelectionError
  ) {
    return new BadRequestException('Invalid transaction classification.');
  }
  return error instanceof Error
    ? error
    : new Error('Unknown transaction classification error.');
}
