import {
  InvalidTemporalSelectionError,
  ListTemporalTransactionsUseCase,
  TemporalProfileUnavailableError,
  type TemporalPeriod,
} from '@seshat/application';
import {
  BadRequestException,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';

import { AuthenticatedActorContext } from '../auth/authenticated-actor-context.js';
import { BearerAuthGuard } from '../auth/bearer-auth.guard.js';
import { ZodValidationPipe } from '../platform/zod-validation.pipe.js';
import {
  mapTransaction,
  type TransactionResponse,
} from './transaction.controller.js';

const querySchema = z.object({
  period: z.enum(['day', 'week', 'month']),
  date: z.iso.date(),
});
type QueryRequest = z.infer<typeof querySchema>;
type TotalResponse = Readonly<{
  currencyCode: string;
  currencyMinorUnitScale: number;
  income: string;
  expense: string;
}>;
type TemporalResponse = Readonly<{
  period: TemporalPeriod;
  selectedDate: string;
  timeZone: string;
  from: string;
  to: string;
  days: readonly Readonly<{
    date: string;
    transactions: readonly (TransactionResponse &
      Readonly<{ timeZone: string }>)[];
    totals: readonly TotalResponse[];
  }>[];
  totals: readonly TotalResponse[];
}>;

@Controller('transactions/temporal')
@ApiTags('transactions')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Bearer token missing or invalid' })
@UseGuards(BearerAuthGuard)
export class TemporalTransactionController {
  public constructor(
    @Inject(ListTemporalTransactionsUseCase)
    private readonly listTemporal: ListTemporalTransactionsUseCase,
    @Inject(AuthenticatedActorContext)
    private readonly actors: AuthenticatedActorContext,
  ) {}

  @Get()
  @ApiOperation({
    summary:
      'List owned transactions by day, Sunday-start week, or month, bucketed by each transaction time zone',
  })
  @ApiQuery({ name: 'period', enum: ['day', 'week', 'month'], required: true })
  @ApiQuery({ name: 'date', format: 'date', type: 'string', required: true })
  @ApiOkResponse({
    schema: {
      type: 'object',
      required: [
        'period',
        'selectedDate',
        'timeZone',
        'from',
        'to',
        'days',
        'totals',
      ],
      properties: {
        period: { type: 'string', enum: ['day', 'week', 'month'] },
        selectedDate: { type: 'string', format: 'date' },
        timeZone: { type: 'string' },
        from: { type: 'string', format: 'date-time' },
        to: { type: 'string', format: 'date-time' },
        days: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              date: { type: 'string', format: 'date' },
              transactions: { type: 'array', items: { type: 'object' } },
              totals: { type: 'array', items: { type: 'object' } },
            },
          },
        },
        totals: { type: 'array', items: { type: 'object' } },
      },
    },
  })
  public async list(
    @Req() request: FastifyRequest,
    @Query(new ZodValidationPipe(querySchema)) query: QueryRequest,
  ): Promise<TemporalResponse> {
    const actor = this.actors.get(request);
    if (actor === undefined) throw new UnauthorizedException();
    try {
      const view = await this.listTemporal.execute(
        actor.id,
        query.period,
        query.date,
      );
      return {
        period: view.period,
        selectedDate: view.selectedDate,
        timeZone: view.timeZone,
        from: view.from.toISOString(),
        to: view.to.toISOString(),
        days: view.days.map((day) => ({
          date: day.date,
          transactions: day.transactions.map(({ transaction, timeZone }) => ({
            ...mapTransaction(transaction),
            timeZone,
          })),
          totals: day.totals,
        })),
        totals: view.totals,
      };
    } catch (error) {
      if (error instanceof InvalidTemporalSelectionError)
        throw new BadRequestException('Invalid temporal selection.');
      if (error instanceof TemporalProfileUnavailableError)
        throw new NotFoundException('User profile not found.');
      throw error;
    }
  }
}
