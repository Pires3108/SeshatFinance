import {
  CardInvoiceNotFoundError,
  CloseCardInvoiceUseCase,
  CreditCardNotFoundError,
  GetCardInvoiceUseCase,
  invoiceRemaining,
  ListCardInvoicesUseCase,
  type CardInvoiceView,
} from '@seshat/application';
import { InvalidCivilDateError } from '@seshat/domain';
import {
  BadRequestException,
  Controller,
  Get,
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
import {
  mapPurchase,
  purchaseSchema,
  type PurchaseResponse,
} from './card-purchase.controller.js';

const cardIdSchema = z.uuid();
const closesOnSchema = z.iso.date();

type InvoiceResponse = Readonly<{
  closedAt: string | null;
  closedTotal: string | null;
  closesOn: string;
  closingBoundary: string;
  configurationPending: boolean;
  currencyCode: string;
  currencyMinorUnitScale: number;
  dueOn: string;
  firstPurchaseDate: string;
  holidayDatasetVersion: string;
  id: string;
  lastPurchaseDate: string;
  purchaseCount: number;
  purchasesTotal: string;
  remaining: string;
  scheduledDueOn: string;
  settledTotal: string;
  status: 'open' | 'closed';
  timeZone: string;
  version: number;
}>;
type InvoiceDetailResponse = InvoiceResponse &
  Readonly<{ purchases: readonly PurchaseResponse[] }>;

const civilDate = { format: 'date', type: 'string' } as const;
const decimal = { pattern: '^-?\\d+(?:\\.\\d+)?$', type: 'string' } as const;
const invoiceProperties: Record<string, SchemaObject> = {
  closedAt: { format: 'date-time', nullable: true, type: 'string' },
  closedTotal: {
    ...decimal,
    description: 'Purchases total frozen at manual closing.',
    nullable: true,
  },
  closesOn: civilDate,
  closingBoundary: { enum: ['next-cycle', 'closing-cycle'], type: 'string' },
  configurationPending: { type: 'boolean' },
  currencyCode: { pattern: '^[A-Z]{3}$', type: 'string' },
  currencyMinorUnitScale: { maximum: 18, minimum: 0, type: 'integer' },
  dueOn: {
    ...civilDate,
    description: 'Effective due date after weekends and holidays.',
  },
  firstPurchaseDate: civilDate,
  holidayDatasetVersion: { type: 'string' },
  id: { format: 'uuid', type: 'string' },
  lastPurchaseDate: civilDate,
  purchaseCount: { minimum: 0, type: 'integer' },
  purchasesTotal: decimal,
  remaining: {
    ...decimal,
    description: 'Purchases total minus declared settlements.',
  },
  scheduledDueOn: civilDate,
  settledTotal: decimal,
  status: { enum: ['open', 'closed'], type: 'string' },
  timeZone: { type: 'string' },
  version: { minimum: 1, type: 'integer' },
};
const invoiceSchema: SchemaObject = {
  properties: invoiceProperties,
  required: Object.keys(invoiceProperties),
  type: 'object',
};
const invoiceDetailSchema: SchemaObject = {
  properties: {
    ...invoiceProperties,
    purchases: { items: purchaseSchema, type: 'array' },
  },
  required: [...Object.keys(invoiceProperties), 'purchases'],
  type: 'object',
};

@Controller('credit-cards/:cardId/invoices')
@ApiTags('credit-cards')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Bearer token missing or invalid' })
@UseGuards(BearerAuthGuard)
export class CardInvoiceController {
  public constructor(
    @Inject(ListCardInvoicesUseCase)
    private readonly listInvoices: ListCardInvoicesUseCase,
    @Inject(GetCardInvoiceUseCase)
    private readonly getInvoice: GetCardInvoiceUseCase,
    @Inject(CloseCardInvoiceUseCase)
    private readonly closeInvoice: CloseCardInvoiceUseCase,
    @Inject(AuthenticatedActorContext)
    private readonly actors: AuthenticatedActorContext,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List invoices of an owned credit card' })
  @ApiParam({ format: 'uuid', name: 'cardId', type: 'string' })
  @ApiOkResponse({ schema: { items: invoiceSchema, type: 'array' } })
  @ApiNotFoundResponse({ description: 'Owned card not found' })
  public async list(
    @Req() request: FastifyRequest,
    @Param('cardId', new ZodValidationPipe(cardIdSchema)) cardId: string,
  ): Promise<readonly InvoiceResponse[]> {
    try {
      const views = await this.listInvoices.execute({
        actorId: this.actorId(request),
        cardId,
      });
      return views.map(mapInvoice);
    } catch (error) {
      throw mapError(error);
    }
  }

  @Get(':closesOn')
  @ApiOperation({
    summary: 'Get an invoice with its purchases (memory of calculation)',
  })
  @ApiParam({ format: 'uuid', name: 'cardId', type: 'string' })
  @ApiParam({ format: 'date', name: 'closesOn', type: 'string' })
  @ApiOkResponse({ schema: invoiceDetailSchema })
  @ApiNotFoundResponse({ description: 'Owned card or invoice not found' })
  public async get(
    @Req() request: FastifyRequest,
    @Param('cardId', new ZodValidationPipe(cardIdSchema)) cardId: string,
    @Param('closesOn', new ZodValidationPipe(closesOnSchema)) closesOn: string,
  ): Promise<InvoiceDetailResponse> {
    try {
      const detail = await this.getInvoice.execute({
        actorId: this.actorId(request),
        cardId,
        closesOn,
      });
      return {
        ...mapInvoice(detail),
        purchases: detail.purchases.map(mapPurchase),
      };
    } catch (error) {
      throw mapError(error);
    }
  }

  @Post(':closesOn/close')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Close an invoice manually; closing again returns the same closed invoice',
  })
  @ApiParam({ format: 'uuid', name: 'cardId', type: 'string' })
  @ApiParam({ format: 'date', name: 'closesOn', type: 'string' })
  @ApiOkResponse({ schema: invoiceSchema })
  @ApiNotFoundResponse({ description: 'Owned card or invoice not found' })
  public async close(
    @Req() request: FastifyRequest,
    @Param('cardId', new ZodValidationPipe(cardIdSchema)) cardId: string,
    @Param('closesOn', new ZodValidationPipe(closesOnSchema)) closesOn: string,
  ): Promise<InvoiceResponse> {
    try {
      return mapInvoice(
        await this.closeInvoice.execute({
          actorId: this.actorId(request),
          cardId,
          closesOn,
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

export function mapInvoice(view: CardInvoiceView): InvoiceResponse {
  const value = view.invoice.toSnapshot();
  return {
    closedAt: value.closedAt?.toISOString() ?? null,
    closedTotal: value.closedTotal?.amount ?? null,
    closesOn: value.closesOn,
    closingBoundary: value.closingBoundary,
    configurationPending: value.configurationPending,
    currencyCode: value.currency.code,
    currencyMinorUnitScale: value.currency.minorUnitScale,
    dueOn: value.dueOn,
    firstPurchaseDate: value.firstPurchaseDate,
    holidayDatasetVersion: value.holidayDatasetVersion,
    id: value.id,
    lastPurchaseDate: value.lastPurchaseDate,
    purchaseCount: view.purchaseCount,
    purchasesTotal: view.purchasesTotal.toDecimal(),
    remaining: invoiceRemaining(view).toDecimal(),
    scheduledDueOn: value.scheduledDueOn,
    settledTotal: view.settledTotal.toDecimal(),
    status: value.status,
    timeZone: value.timeZone,
    version: value.version,
  };
}

function mapError(error: unknown): Error {
  if (
    error instanceof CreditCardNotFoundError ||
    error instanceof CardInvoiceNotFoundError
  ) {
    return new NotFoundException('Credit card invoice not found.');
  }
  if (error instanceof InvalidCivilDateError) {
    return new BadRequestException('Invalid invoice date.');
  }
  return error instanceof Error ? error : new Error('Unknown invoice error.');
}
