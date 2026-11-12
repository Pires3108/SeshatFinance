import {
  GetOwnedLinkedRefundsUseCase,
  GetOwnUserProfileUseCase,
  InvalidLinkedRefundCommandError,
  LinkedRefundConflictError,
  LinkedRefundUnavailableError,
  RecordLinkedRefundUseCase,
  type LinkedRefundDetails,
  type LinkedRefundRecord,
} from '@seshat/application';
import {
  InvalidCurrencyError,
  InvalidMoneyAmountError,
  InvalidRefundLedgerError,
  InvalidTransactionError,
} from '@seshat/domain';
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Headers,
  Inject,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiHeader,
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
const presentationSchema = z.enum(['separate-income', 'expense-offset']);
const createSchema = z
  .object({
    accountId: idSchema,
    amount: z
      .string()
      .max(1002)
      .regex(/^\d+(?:\.\d+)?$/u),
    currencyCode: z.string().regex(/^[A-Z]{3}$/u),
    currencyMinorUnitScale: z.number().int().min(0).max(18),
    description: z.string().trim().min(1).nullable(),
    occurredAt: z.iso.datetime({ offset: true }),
    compensatesRefundId: idSchema.optional(),
    reason: z.string().trim().min(1).max(1000).optional(),
  })
  .refine(
    (value) =>
      (value.compensatesRefundId === undefined) ===
      (value.reason === undefined),
  );
type CreateRequest = z.infer<typeof createSchema>;
type EntryResponse = Readonly<{
  id: string;
  kind: 'refund' | 'compensation';
  expenseTransactionId: string;
  entryTransactionId: string;
  accountId: string;
  amount: string;
  currencyCode: string;
  currencyMinorUnitScale: number;
  description: string | null;
  occurredAt: string;
  lifecycle: 'active' | 'archived' | 'trashed';
  compensatesRefundId: string | null;
  reason: string | null;
  createdAt: string;
}>;
type DetailsResponse = Readonly<{
  expenseTransactionId: string;
  gross: string;
  refunded: string;
  net: string;
  currencyCode: string;
  currencyMinorUnitScale: number;
  entries: readonly EntryResponse[];
  presentation: 'separate-income' | 'expense-offset';
  displayedExpense: string;
  displayedRefundIncome: string;
}>;

const entrySchema: SchemaObject = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    kind: { type: 'string', enum: ['refund', 'compensation'] },
    expenseTransactionId: { type: 'string', format: 'uuid' },
    entryTransactionId: { type: 'string', format: 'uuid' },
    accountId: { type: 'string', format: 'uuid' },
    amount: { type: 'string' },
    currencyCode: { type: 'string' },
    currencyMinorUnitScale: { type: 'integer' },
    description: { type: 'string', nullable: true },
    occurredAt: { type: 'string', format: 'date-time' },
    lifecycle: { type: 'string', enum: ['active', 'archived', 'trashed'] },
    compensatesRefundId: { type: 'string', format: 'uuid', nullable: true },
    reason: { type: 'string', nullable: true },
    createdAt: { type: 'string', format: 'date-time' },
  },
  required: [
    'id',
    'kind',
    'expenseTransactionId',
    'entryTransactionId',
    'accountId',
    'amount',
    'currencyCode',
    'currencyMinorUnitScale',
    'description',
    'occurredAt',
    'lifecycle',
    'compensatesRefundId',
    'reason',
    'createdAt',
  ],
};

@Controller('transactions/:expenseTransactionId/refunds')
@ApiTags('refunds')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Autenticação obrigatória' })
@ApiParam({ name: 'expenseTransactionId', format: 'uuid', type: 'string' })
@UseGuards(BearerAuthGuard)
export class LinkedRefundController {
  public constructor(
    @Inject(RecordLinkedRefundUseCase)
    private readonly recordRefund: RecordLinkedRefundUseCase,
    @Inject(GetOwnedLinkedRefundsUseCase)
    private readonly getRefunds: GetOwnedLinkedRefundsUseCase,
    @Inject(GetOwnUserProfileUseCase)
    private readonly getProfile: GetOwnUserProfileUseCase,
    @Inject(AuthenticatedActorContext)
    private readonly actors: AuthenticatedActorContext,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Registrar reembolso ou compensação vinculada' })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    description: 'UUID da operação',
  })
  @ApiBody({
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        accountId: { type: 'string', format: 'uuid' },
        amount: { type: 'string' },
        currencyCode: { type: 'string' },
        currencyMinorUnitScale: { type: 'integer' },
        description: { type: 'string', nullable: true },
        occurredAt: { type: 'string', format: 'date-time' },
        compensatesRefundId: { type: 'string', format: 'uuid' },
        reason: { type: 'string' },
      },
      required: [
        'accountId',
        'amount',
        'currencyCode',
        'currencyMinorUnitScale',
        'description',
        'occurredAt',
      ],
    },
  })
  @ApiCreatedResponse({ schema: entrySchema })
  @ApiConflictResponse({
    description: 'Limite, compensação ou chave de idempotência conflitante',
  })
  public async create(
    @Req() request: FastifyRequest,
    @Param('expenseTransactionId', new ZodValidationPipe(idSchema))
    expenseTransactionId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body(new ZodValidationPipe(createSchema)) body: CreateRequest,
  ): Promise<EntryResponse> {
    const key = idSchema.safeParse(idempotencyKey);
    if (!key.success) {
      throw new BadRequestException('Chave de idempotência inválida.');
    }
    try {
      return mapEntry(
        await this.recordRefund.execute({
          actorId: this.actorId(request),
          expenseTransactionId,
          accountId: body.accountId,
          amount: body.amount,
          currencyCode: body.currencyCode,
          currencyMinorUnitScale: body.currencyMinorUnitScale,
          description: body.description,
          occurredAt: new Date(body.occurredAt),
          idempotencyKey: key.data,
          ...(body.compensatesRefundId === undefined
            ? {}
            : {
                compensatesRefundId: body.compensatesRefundId,
              }),
          ...(body.reason === undefined ? {} : { reason: body.reason }),
        }),
      );
    } catch (error) {
      throw mapError(error);
    }
  }

  @Get()
  @ApiOperation({ summary: 'Consultar reembolsos e valor líquido da despesa' })
  @ApiQuery({
    name: 'presentation',
    required: false,
    enum: ['separate-income', 'expense-offset'],
  })
  @ApiOkResponse({
    schema: {
      type: 'object',
      properties: {
        expenseTransactionId: { type: 'string', format: 'uuid' },
        gross: { type: 'string' },
        refunded: { type: 'string' },
        net: { type: 'string' },
        currencyCode: { type: 'string' },
        currencyMinorUnitScale: { type: 'integer' },
        entries: { type: 'array', items: entrySchema },
        presentation: {
          type: 'string',
          enum: ['separate-income', 'expense-offset'],
        },
        displayedExpense: { type: 'string' },
        displayedRefundIncome: { type: 'string' },
      },
      required: [
        'expenseTransactionId',
        'gross',
        'refunded',
        'net',
        'currencyCode',
        'currencyMinorUnitScale',
        'entries',
        'presentation',
        'displayedExpense',
        'displayedRefundIncome',
      ],
    },
  })
  @ApiNotFoundResponse({ description: 'Despesa não encontrada' })
  public async list(
    @Req() request: FastifyRequest,
    @Param('expenseTransactionId', new ZodValidationPipe(idSchema))
    expenseTransactionId: string,
    @Query('presentation', new ZodValidationPipe(presentationSchema.optional()))
    presentation: 'separate-income' | 'expense-offset' | undefined,
  ): Promise<DetailsResponse> {
    const actorId = this.actorId(request);
    const details = await this.getRefunds.getForExpense(
      expenseTransactionId,
      actorId,
    );
    if (details === null)
      throw new NotFoundException('Despesa não encontrada.');
    const selectedPresentation =
      presentation ??
      (await this.getProfile.execute(actorId))?.refundPresentation ??
      'separate-income';
    return mapDetails(details, selectedPresentation);
  }

  private actorId(request: FastifyRequest): string {
    const actor = this.actors.get(request);
    if (actor === undefined) throw new UnauthorizedException();
    return actor.id;
  }
}

function mapEntry(record: LinkedRefundRecord): EntryResponse {
  const entry = record.entry.toSnapshot();
  return {
    id: record.id,
    kind: record.kind,
    expenseTransactionId: record.expenseTransactionId,
    entryTransactionId: entry.id,
    accountId: entry.accountId,
    amount: entry.amount.amount,
    currencyCode: entry.amount.currency.code,
    currencyMinorUnitScale: entry.amount.currency.minorUnitScale,
    description: entry.description,
    occurredAt: entry.occurredAt.toISOString(),
    lifecycle: entry.lifecycle,
    compensatesRefundId: record.compensatesRefundId,
    reason: record.reason,
    createdAt: record.createdAt.toISOString(),
  };
}

function mapDetails(
  details: LinkedRefundDetails,
  presentation: 'separate-income' | 'expense-offset',
): DetailsResponse {
  const offset = presentation === 'expense-offset';
  return {
    expenseTransactionId: details.expenseTransactionId,
    gross: details.summary.gross.toDecimal(),
    refunded: details.summary.refunded.toDecimal(),
    net: details.summary.net.toDecimal(),
    currencyCode: details.summary.gross.currency.code,
    currencyMinorUnitScale: details.summary.gross.currency.minorUnitScale,
    entries: details.entries.map(mapEntry),
    presentation,
    displayedExpense: (offset
      ? details.summary.net
      : details.summary.gross
    ).toDecimal(),
    displayedRefundIncome: (offset
      ? details.summary.refunded.subtract(details.summary.refunded)
      : details.summary.refunded
    ).toDecimal(),
  };
}

function mapError(error: unknown): Error {
  if (error instanceof LinkedRefundUnavailableError)
    return new NotFoundException('Despesa, conta ou reembolso indisponível.');
  if (
    error instanceof LinkedRefundConflictError ||
    error instanceof InvalidRefundLedgerError
  )
    return new ConflictException(
      'Reembolso incompatível com os vínculos atuais.',
    );
  if (
    error instanceof InvalidLinkedRefundCommandError ||
    error instanceof InvalidCurrencyError ||
    error instanceof InvalidMoneyAmountError ||
    error instanceof InvalidTransactionError
  )
    return new BadRequestException('Dados de reembolso inválidos.');
  return error instanceof Error ? error : new Error('Unknown refund error.');
}
