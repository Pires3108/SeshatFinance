import {
  GetOwnedAccountBalanceUseCase,
  OwnedAccountNotFoundError,
} from '@seshat/application';
import {
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
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

type AccountBalanceResponse = Readonly<{
  amount: string;
  currencyCode: string;
  currencyMinorUnitScale: number;
}>;

@Controller('accounts')
@ApiTags('accounts')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Bearer token missing or invalid' })
@UseGuards(BearerAuthGuard)
export class AccountBalanceController {
  public constructor(
    @Inject(GetOwnedAccountBalanceUseCase)
    private readonly getBalance: GetOwnedAccountBalanceUseCase,
    @Inject(AuthenticatedActorContext)
    private readonly actors: AuthenticatedActorContext,
  ) {}

  @Get(':accountId/balance')
  @ApiOperation({ summary: 'Calculate the exact balance of an owned account' })
  @ApiParam({ format: 'uuid', name: 'accountId', type: 'string' })
  @ApiOkResponse({
    schema: {
      properties: {
        amount: { pattern: '^-?\\d+(?:\\.\\d+)?$', type: 'string' },
        currencyCode: { pattern: '^[A-Z]{3}$', type: 'string' },
        currencyMinorUnitScale: { maximum: 18, minimum: 0, type: 'integer' },
      },
      required: ['amount', 'currencyCode', 'currencyMinorUnitScale'],
      type: 'object',
    },
  })
  @ApiNotFoundResponse({ description: 'Owned account was not found' })
  public async get(
    @Req() request: FastifyRequest,
    @Param('accountId', new ZodValidationPipe(z.uuid())) accountId: string,
  ): Promise<AccountBalanceResponse> {
    try {
      const balance = await this.getBalance.execute(
        accountId,
        this.actorId(request),
      );
      return {
        amount: balance.toDecimal(),
        currencyCode: balance.currency.code,
        currencyMinorUnitScale: balance.currency.minorUnitScale,
      };
    } catch (error) {
      if (error instanceof OwnedAccountNotFoundError) {
        throw new NotFoundException('Account not found.');
      }
      throw error;
    }
  }

  private actorId(request: FastifyRequest): string {
    const actor = this.actors.get(request);
    if (actor === undefined) throw new UnauthorizedException();
    return actor.id;
  }
}
