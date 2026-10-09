import type { FinancialAuditEvent, ManualExchangeQuote } from '@seshat/domain';
import { describe, expect, it } from 'vitest';

import type { Clock } from '../ports/clock.js';
import type { IdentifierGenerator } from '../ports/identifier-generator.js';
import {
  CorrectOwnedManualExchangeQuoteUseCase,
  CreateManualExchangeQuoteUseCase,
  ManualExchangeQuoteIdempotencyConflictError,
  ManualExchangeQuoteVersionConflictError,
  OwnedManualExchangeQuoteNotFoundError,
  type ManualExchangeQuoteRepository,
} from './manage-manual-exchange-quote.js';

const clock: Clock = { now: (): Date => new Date('2026-10-01T12:00:00.000Z') };
const identifiers: IdentifierGenerator = {
  generate: (() => {
    let next = 0;
    return (): string => `id-${String(++next)}`;
  })(),
};

function repository(): ManualExchangeQuoteRepository & {
  inserted: ManualExchangeQuote[];
  audit: FinancialAuditEvent[];
} {
  const inserted: ManualExchangeQuote[] = [];
  const audit: FinancialAuditEvent[] = [];
  const byKey = new Map<string, ManualExchangeQuote>();
  return {
    inserted,
    audit,
    insertVersion: (quote, event, idempotencyKey) => {
      const key = `${quote.toSnapshot().ownerId}:${event.action}:${idempotencyKey}`;
      if (byKey.has(key)) return Promise.resolve(false);
      inserted.push(quote);
      audit.push(event);
      byKey.set(key, quote);
      return Promise.resolve(true);
    },
    findByIdempotencyKeyForOwner: (ownerId, action, idempotencyKey) =>
      Promise.resolve(
        byKey.get(`${ownerId}:${action}:${idempotencyKey}`) ?? null,
      ),
    findLatestForOwner: (id, ownerId) =>
      Promise.resolve(
        [...inserted].reverse().find((quote) => {
          const snapshot = quote.toSnapshot();
          return snapshot.id === id && snapshot.ownerId === ownerId;
        }) ?? null,
      ),
    listLatestForOwner: (ownerId) =>
      Promise.resolve(
        inserted.filter((quote) => quote.toSnapshot().ownerId === ownerId),
      ),
  };
}

describe('manual exchange quote use cases', () => {
  it('preserves original rate and appends an authorized correction with audit metadata', async () => {
    const quotes = repository();
    const original = await new CreateManualExchangeQuoteUseCase(
      quotes,
      clock,
      identifiers,
    ).execute({
      actorId: 'owner-id',
      effectiveAt: new Date('2026-09-30T12:00:00.000Z'),
      idempotencyKey: 'create-1',
      rate: '5.123456789123456789',
      source: 'Declared bank quote',
      sourceCurrencyCode: 'USD',
      targetCurrencyCode: 'BRL',
    });
    const correctUseCase = new CorrectOwnedManualExchangeQuoteUseCase(
      quotes,
      clock,
      identifiers,
    );
    const correction = {
      actorId: 'owner-id',
      effectiveAt: new Date('2026-10-01T11:00:00.000Z'),
      idempotencyKey: 'correct-1',
      quoteId: original.toSnapshot().id,
      rate: '5.2',
      source: 'Manual correction',
    };
    const corrected = await correctUseCase.execute(correction);
    expect((await correctUseCase.execute(correction)).toSnapshot()).toEqual(
      corrected.toSnapshot(),
    );
    expect(quotes.inserted.map((quote) => quote.toSnapshot().rate)).toEqual([
      '5.123456789123456789',
      '5.2',
    ]);
    expect(corrected.toSnapshot()).toMatchObject({
      version: 2,
      ownerId: 'owner-id',
    });
    expect(quotes.audit.map((event) => event.toSnapshot())).toMatchObject([
      {
        action: 'created',
        resourceType: 'manual-exchange-quote',
        ownerId: 'owner-id',
      },
      {
        action: 'updated',
        resourceType: 'manual-exchange-quote',
        ownerId: 'owner-id',
      },
    ]);
  });

  it('never reveals or corrects another owner’s quote', async () => {
    const quotes = repository();
    const original = await new CreateManualExchangeQuoteUseCase(
      quotes,
      clock,
      identifiers,
    ).execute({
      actorId: 'owner-id',
      effectiveAt: new Date('2026-09-30T12:00:00.000Z'),
      idempotencyKey: 'create-2',
      rate: '5.1',
      source: 'Declared quote',
      sourceCurrencyCode: 'USD',
      targetCurrencyCode: 'BRL',
    });
    await expect(
      new CorrectOwnedManualExchangeQuoteUseCase(
        quotes,
        clock,
        identifiers,
      ).execute({
        actorId: 'other-owner',
        effectiveAt: new Date('2026-10-01T11:00:00.000Z'),
        idempotencyKey: 'correct-2',
        quoteId: original.toSnapshot().id,
        rate: '5.2',
        source: 'Unauthorized correction',
      }),
    ).rejects.toBeInstanceOf(OwnedManualExchangeQuoteNotFoundError);
    expect(quotes.inserted).toHaveLength(1);
  });

  it('reports a version conflict without claiming a successful correction', async () => {
    const quotes = repository();
    const original = await new CreateManualExchangeQuoteUseCase(
      quotes,
      clock,
      identifiers,
    ).execute({
      actorId: 'owner-id',
      effectiveAt: new Date('2026-09-30T12:00:00.000Z'),
      idempotencyKey: 'create-3',
      rate: '5.1',
      source: 'Declared quote',
      sourceCurrencyCode: 'USD',
      targetCurrencyCode: 'BRL',
    });
    quotes.insertVersion = () => Promise.resolve(false);
    await expect(
      new CorrectOwnedManualExchangeQuoteUseCase(
        quotes,
        clock,
        identifiers,
      ).execute({
        actorId: 'owner-id',
        effectiveAt: new Date('2026-10-01T11:00:00.000Z'),
        idempotencyKey: 'correct-3',
        quoteId: original.toSnapshot().id,
        rate: '5.2',
        source: 'Concurrent correction',
      }),
    ).rejects.toBeInstanceOf(ManualExchangeQuoteVersionConflictError);
  });

  it('returns the first result for an identical retry and rejects key reuse with different details', async () => {
    const quotes = repository();
    const useCase = new CreateManualExchangeQuoteUseCase(
      quotes,
      clock,
      identifiers,
    );
    const command = {
      actorId: 'owner-id',
      effectiveAt: new Date('2026-09-30T12:00:00.000Z'),
      idempotencyKey: 'same-command',
      rate: '5.1',
      source: 'Declared quote',
      sourceCurrencyCode: 'USD' as const,
      targetCurrencyCode: 'BRL' as const,
    };
    const first = await useCase.execute(command);
    expect((await useCase.execute(command)).toSnapshot()).toEqual(
      first.toSnapshot(),
    );
    expect(quotes.inserted).toHaveLength(1);
    expect(quotes.audit).toHaveLength(1);
    await expect(
      useCase.execute({ ...command, rate: '5.2' }),
    ).rejects.toBeInstanceOf(ManualExchangeQuoteIdempotencyConflictError);
  });
});
