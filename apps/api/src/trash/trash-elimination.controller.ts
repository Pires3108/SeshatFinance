import {
  EliminateOwnedTrashItemUseCase,
  OwnedTransactionNotFoundError,
  OwnedTransferNotFoundError,
  TransactionRequiresTransferMutationError,
  TransactionRequiresCardSettlementMutationError,
  TransactionVersionConflictError,
  TransferVersionConflictError,
  TrashEliminationBlockedError,
  TrashEliminationConfirmationError,
} from '@seshat/application';
import { TransactionLifecycleError } from '@seshat/domain';
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';

import { AuthenticatedActorContext } from '../auth/authenticated-actor-context.js';
import { BearerAuthGuard } from '../auth/bearer-auth.guard.js';
import { ZodValidationPipe } from '../platform/zod-validation.pipe.js';

const idSchema = z.uuid();
const confirmationSchema = z
  .object({ confirmation: z.string().trim().min(1).max(64) })
  .strict();
type ConfirmationRequest = z.infer<typeof confirmationSchema>;

const confirmationBody = {
  schema: {
    additionalProperties: false,
    properties: {
      confirmation: {
        description:
          'Reinforced confirmation: the identifier of the item being eliminated.',
        type: 'string',
      },
    },
    required: ['confirmation'],
    type: 'object' as const,
  },
};

/**
 * Permanent elimination from the trash (RF-090, RII-026 option b). The item
 * stays stored for revisions and audit but leaves every view for good.
 */
@Controller()
@ApiTags('trash')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Bearer token missing or invalid' })
@UseGuards(BearerAuthGuard)
export class TrashEliminationController {
  public constructor(
    @Inject(EliminateOwnedTrashItemUseCase)
    private readonly eliminate: EliminateOwnedTrashItemUseCase,
    @Inject(AuthenticatedActorContext)
    private readonly actors: AuthenticatedActorContext,
  ) {}

  @Post('transactions/:transactionId/elimination')
  @HttpCode(204)
  @ApiOperation({ summary: 'Permanently eliminate a transaction in the trash' })
  @ApiParam({ format: 'uuid', name: 'transactionId', type: 'string' })
  @ApiBody(confirmationBody)
  @ApiNoContentResponse({ description: 'Eliminated' })
  @ApiBadRequestResponse({ description: 'Confirmation does not match' })
  @ApiNotFoundResponse({ description: 'Owned transaction not found' })
  @ApiConflictResponse({
    description:
      'Not in the trash, part of a transfer, linked to a refund or adjustment, or changed concurrently',
  })
  public async eliminateTransaction(
    @Req() request: FastifyRequest,
    @Param('transactionId', new ZodValidationPipe(idSchema))
    transactionId: string,
    @Body(new ZodValidationPipe(confirmationSchema)) body: ConfirmationRequest,
  ): Promise<void> {
    await this.run(request, 'transaction', transactionId, body.confirmation);
  }

  @Post('transfers/:transferId/elimination')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Permanently eliminate a transfer pair in the trash',
  })
  @ApiParam({ format: 'uuid', name: 'transferId', type: 'string' })
  @ApiBody(confirmationBody)
  @ApiNoContentResponse({ description: 'Eliminated' })
  @ApiBadRequestResponse({ description: 'Confirmation does not match' })
  @ApiNotFoundResponse({ description: 'Owned transfer not found' })
  @ApiConflictResponse({
    description: 'Not in the trash or changed concurrently',
  })
  public async eliminateTransfer(
    @Req() request: FastifyRequest,
    @Param('transferId', new ZodValidationPipe(idSchema)) transferId: string,
    @Body(new ZodValidationPipe(confirmationSchema)) body: ConfirmationRequest,
  ): Promise<void> {
    await this.run(request, 'transfer', transferId, body.confirmation);
  }

  private async run(
    request: FastifyRequest,
    resourceType: 'transaction' | 'transfer',
    id: string,
    confirmation: string,
  ): Promise<void> {
    const actor = this.actors.get(request);
    if (actor === undefined) throw new UnauthorizedException();
    try {
      await this.eliminate.execute({
        actorId: actor.id,
        confirmation,
        id,
        resourceType,
      });
    } catch (error) {
      throw mapError(error);
    }
  }
}

function mapError(error: unknown): Error {
  if (error instanceof TrashEliminationConfirmationError)
    return new BadRequestException('Confirmation does not match the item.');
  if (
    error instanceof OwnedTransactionNotFoundError ||
    error instanceof OwnedTransferNotFoundError
  )
    return new NotFoundException('Item not found.');
  if (error instanceof TrashEliminationBlockedError)
    return new ConflictException(
      'Linked refunds or adjustments keep this entry in history.',
    );
  if (error instanceof TransactionRequiresCardSettlementMutationError)
    return new ConflictException(
      'Card settlement entries cannot be changed on their own.',
    );
  if (error instanceof TransactionRequiresTransferMutationError)
    return new ConflictException(
      'Transfer entries must be eliminated through the transfer.',
    );
  if (error instanceof TransactionLifecycleError)
    return new ConflictException('Only items in the trash can be eliminated.');
  if (
    error instanceof TransactionVersionConflictError ||
    error instanceof TransferVersionConflictError
  )
    return new ConflictException('Item changed concurrently.');
  return error instanceof Error
    ? error
    : new Error('Unknown elimination error.');
}
