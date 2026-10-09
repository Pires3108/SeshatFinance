import type { ManualExchangeQuoteRepository } from '@seshat/application';
import {
  ManualExchangeQuote,
  manualQuoteCurrency,
  type FinancialAuditEvent,
} from '@seshat/domain';

import { insertFinancialAuditEvent } from '../audit/prisma-financial-audit-event-repository.js';
import { Prisma, type PrismaClient } from '../generated/prisma/client.js';

export class PrismaManualExchangeQuoteRepository implements ManualExchangeQuoteRepository {
  public constructor(private readonly client: PrismaClient) {}

  public async insertVersion(
    quote: ManualExchangeQuote,
    auditEvent: FinancialAuditEvent,
    idempotencyKey: string,
  ): Promise<boolean> {
    const snapshot = quote.toSnapshot();
    try {
      await this.client.$transaction(async (client) => {
        await client.manualExchangeQuoteVersion.create({
          data: {
            authorId: snapshot.authorId,
            commandType: auditEvent.action,
            effectiveAt: snapshot.effectiveAt,
            idempotencyKey,
            ownerId: snapshot.ownerId,
            quoteId: snapshot.id,
            rate: snapshot.rate,
            recordedAt: snapshot.recordedAt,
            source: snapshot.source,
            sourceCurrencyCode: snapshot.sourceCurrencyCode,
            targetCurrencyCode: snapshot.targetCurrencyCode,
            version: snapshot.version,
          },
        });
        await insertFinancialAuditEvent(client, auditEvent);
      });
      return true;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        (error.code === 'P2002' || error.code === 'P2034')
      )
        return false;
      throw error;
    }
  }

  public async findByIdempotencyKeyForOwner(
    ownerId: string,
    action: 'created' | 'updated',
    idempotencyKey: string,
  ): Promise<ManualExchangeQuote | null> {
    const row = await this.client.manualExchangeQuoteVersion.findUnique({
      where: {
        ownerId_commandType_idempotencyKey: {
          ownerId,
          commandType: action,
          idempotencyKey,
        },
      },
    });
    return row === null ? null : restore(row);
  }

  public async findLatestForOwner(
    id: string,
    ownerId: string,
  ): Promise<ManualExchangeQuote | null> {
    const row = await this.client.manualExchangeQuoteVersion.findFirst({
      orderBy: { version: 'desc' },
      where: { quoteId: id, ownerId },
    });
    return row === null ? null : restore(row);
  }

  public async listLatestForOwner(
    ownerId: string,
  ): Promise<readonly ManualExchangeQuote[]> {
    const rows = await this.client.manualExchangeQuoteVersion.findMany({
      orderBy: [{ quoteId: 'asc' }, { version: 'desc' }],
      where: { ownerId },
    });
    const latest = new Map<string, ManualExchangeQuote>();
    for (const row of rows) {
      if (!latest.has(row.quoteId)) latest.set(row.quoteId, restore(row));
    }
    return [...latest.values()];
  }
}

function restore(row: {
  authorId: string;
  effectiveAt: Date;
  ownerId: string;
  quoteId: string;
  rate: string;
  recordedAt: Date;
  source: string;
  sourceCurrencyCode: string;
  targetCurrencyCode: string;
  version: number;
}): ManualExchangeQuote {
  return ManualExchangeQuote.restore({
    authorId: row.authorId,
    effectiveAt: row.effectiveAt,
    id: row.quoteId,
    ownerId: row.ownerId,
    rate: row.rate,
    recordedAt: row.recordedAt,
    source: row.source,
    sourceCurrencyCode: manualQuoteCurrency(row.sourceCurrencyCode),
    targetCurrencyCode: manualQuoteCurrency(row.targetCurrencyCode),
    version: row.version,
  });
}
