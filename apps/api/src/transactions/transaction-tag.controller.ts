import {
  InvalidOwnedTagSelectionError,
  ListOwnedTransactionTagsUseCase,
  OwnedTransactionNotFoundError,
  SetOwnedTransactionTagsUseCase,
  TransactionRequiresTransferMutationError,
} from '@seshat/application';
import {
  BadRequestException,
  Body,
  Controller,
  ConflictException,
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
  ApiConflictResponse,
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
const setTagsSchema = z.object({
  tagIds: z.array(idSchema).max(500),
});
type SetTagsRequest = z.infer<typeof setTagsSchema>;
type Response = Readonly<{ tagIds: readonly string[] }>;

const responseSchema: SchemaObject = {
  additionalProperties: false,
  properties: {
    tagIds: {
      items: { format: 'uuid', type: 'string' },
      maxItems: 500,
      type: 'array',
      uniqueItems: true,
    },
  },
  required: ['tagIds'],
  type: 'object',
};
const requestSchema: SchemaObject = {
  additionalProperties: false,
  properties: {
    tagIds: {
      items: { format: 'uuid', type: 'string' },
      maxItems: 500,
      type: 'array',
    },
  },
  required: ['tagIds'],
  type: 'object',
};

@Controller('transactions/:transactionId/tags')
@ApiTags('transactions')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Bearer token missing or invalid' })
@UseGuards(BearerAuthGuard)
export class TransactionTagController {
  public constructor(
    @Inject(ListOwnedTransactionTagsUseCase)
    private readonly listTags: ListOwnedTransactionTagsUseCase,
    @Inject(SetOwnedTransactionTagsUseCase)
    private readonly setTags: SetOwnedTransactionTagsUseCase,
    @Inject(AuthenticatedActorContext)
    private readonly actors: AuthenticatedActorContext,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'List tag identifiers assigned to an owned transaction',
  })
  @ApiParam({ format: 'uuid', name: 'transactionId', type: 'string' })
  @ApiOkResponse({ schema: responseSchema })
  @ApiNotFoundResponse({ description: 'Owned transaction was not found' })
  public async list(
    @Req() request: FastifyRequest,
    @Param('transactionId', new ZodValidationPipe(idSchema))
    transactionId: string,
  ): Promise<Response> {
    try {
      return {
        tagIds: await this.listTags.execute(
          transactionId,
          this.actorId(request),
        ),
      };
    } catch (error) {
      throw mapError(error);
    }
  }

  @Put()
  @ApiOperation({ summary: 'Replace tags assigned to an owned transaction' })
  @ApiParam({ format: 'uuid', name: 'transactionId', type: 'string' })
  @ApiBody({ schema: requestSchema })
  @ApiOkResponse({ schema: responseSchema })
  @ApiBadRequestResponse({
    description: 'A selected tag is not owned by the actor',
  })
  @ApiNotFoundResponse({ description: 'Owned transaction was not found' })
  @ApiConflictResponse({ description: 'Transaction belongs to a transfer' })
  public async replace(
    @Req() request: FastifyRequest,
    @Param('transactionId', new ZodValidationPipe(idSchema))
    transactionId: string,
    @Body(new ZodValidationPipe(setTagsSchema)) body: SetTagsRequest,
  ): Promise<Response> {
    try {
      return {
        tagIds: await this.setTags.execute({
          actorId: this.actorId(request),
          tagIds: body.tagIds,
          transactionId,
        }),
      };
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
  if (error instanceof OwnedTransactionNotFoundError)
    return new NotFoundException('Transaction not found.');
  if (error instanceof InvalidOwnedTagSelectionError)
    return new BadRequestException(
      'Every selected tag must belong to the actor.',
    );
  if (error instanceof TransactionRequiresTransferMutationError)
    return new ConflictException(
      'Transfer entries must be changed through the transfer endpoint.',
    );
  return error instanceof Error
    ? error
    : new Error('Unknown transaction tag error.');
}
