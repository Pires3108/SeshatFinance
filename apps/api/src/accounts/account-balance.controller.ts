import {
  GetOwnedAccountBalanceUseCase,
  GetOwnedBalanceSummaryUseCase,
  OwnedAccountNotFoundError,
  type OwnedBalanceSummary,
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
  type SchemaObject,
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

type BalanceSummaryResponse = Readonly<{
  accountBalances: readonly (AccountBalanceResponse & { accountId: string })[];
  totalsByCurrency: readonly AccountBalanceResponse[];
  brlConsolidation:
    | Readonly<{ status: 'available'; balance: AccountBalanceResponse }>
    | Readonly<{
        status: 'unavailable';
        reason: 'conversion-policy-pending' | 'currency-scale-mismatch';
      }>;
}>;

const balanceSchema: SchemaObject = {
  properties: {
    amount: { pattern: '^-?\\d+(?:\\.\\d+)?$', type: 'string' },
    currencyCode: { pattern: '^[A-Z]{3}$', type: 'string' },
    currencyMinorUnitScale: { maximum: 18, minimum: 0, type: 'integer' },
  },
  required: ['amount', 'currencyCode', 'currencyMinorUnitScale'],
  type: 'object',
};

@Controller('accounts')
@ApiTags('accounts')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Bearer token missing or invalid' })
@UseGuards(BearerAuthGuard)
export class AccountBalanceController {
  public constructor(
    @Inject(GetOwnedAccountBalanceUseCase)
    private readonly getBalance: GetOwnedAccountBalanceUseCase,
    @Inject(GetOwnedBalanceSummaryUseCase)
    private readonly getSummary: GetOwnedBalanceSummaryUseCase,
    @Inject(AuthenticatedActorContext)
    private readonly actors: AuthenticatedActorContext,
  ) {}

  @Get('consolidation')
  @ApiOperation({
    summary: 'List exact owned balances and BRL consolidation availability',
  })
  @ApiOkResponse({
    schema: {
      properties: {
        accountBalances: {
          items: {
            properties: {
              ...balanceSchema.properties,
              accountId: { format: 'uuid', type: 'string' },
            },
            required: [
              'amount',
              'currencyCode',
              'currencyMinorUnitScale',
              'accountId',
            ],
            type: 'object',
          },
          type: 'array',
        },
        brlConsolidation: {
          oneOf: [
            {
              properties: {
                balance: balanceSchema,
                status: { enum: ['available'], type: 'string' },
              },
              required: ['balance', 'status'],
              type: 'object',
            },
            {
              properties: {
                reason: {
                  enum: [
                    'conversion-policy-pending',
                    'currency-scale-mismatch',
                  ],
                  type: 'string',
                },
                status: { enum: ['unavailable'], type: 'string' },
              },
              required: ['reason', 'status'],
              type: 'object',
            },
          ],
        },
        totalsByCurrency: { items: balanceSchema, type: 'array' },
      },
      required: ['accountBalances', 'brlConsolidation', 'totalsByCurrency'],
      type: 'object',
    },
  })
  public async consolidation(
    @Req() request: FastifyRequest,
  ): Promise<BalanceSummaryResponse> {
    return mapSummary(await this.getSummary.execute(this.actorId(request)));
  }

  @Get(':accountId/balance')
  @ApiOperation({ summary: 'Calculate the exact balance of an owned account' })
  @ApiParam({ format: 'uuid', name: 'accountId', type: 'string' })
  @ApiOkResponse({
    schema: balanceSchema,
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

function mapSummary(summary: OwnedBalanceSummary): BalanceSummaryResponse {
  const mapBalance = (
    balance: OwnedBalanceSummary['totalsByCurrency'][number],
  ): AccountBalanceResponse => ({
    amount: balance.toDecimal(),
    currencyCode: balance.currency.code,
    currencyMinorUnitScale: balance.currency.minorUnitScale,
  });
  return {
    accountBalances: summary.accountBalances.map(({ accountId, balance }) => ({
      accountId,
      ...mapBalance(balance),
    })),
    brlConsolidation:
      summary.brlConsolidation.status === 'available'
        ? {
            balance: mapBalance(summary.brlConsolidation.balance),
            status: 'available',
          }
        : summary.brlConsolidation,
    totalsByCurrency: summary.totalsByCurrency.map(mapBalance),
  };
}
