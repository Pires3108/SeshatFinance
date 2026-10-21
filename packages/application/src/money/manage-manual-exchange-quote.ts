import {
  FinancialAuditEvent,
  ManualExchangeQuote,
  type ManualQuoteCurrency,
} from '@seshat/domain';

import type { Clock } from '../ports/clock.js';
import type { IdentifierGenerator } from '../ports/identifier-generator.js';

export interface ManualExchangeQuoteRepository {
  insertVersion(
    quote: ManualExchangeQuote,
    auditEvent: FinancialAuditEvent,
    idempotencyKey: string,
  ): Promise<boolean>;
  findByIdempotencyKeyForOwner(
    ownerId: string,
    action: 'created' | 'updated',
    idempotencyKey: string,
  ): Promise<ManualExchangeQuote | null>;
  findLatestForOwner(
    id: string,
    ownerId: string,
  ): Promise<ManualExchangeQuote | null>;
  listLatestForOwner(ownerId: string): Promise<readonly ManualExchangeQuote[]>;
}

export class OwnedManualExchangeQuoteNotFoundError extends Error {
  public constructor() {
    super('Owned manual exchange quote was not found.');
    this.name = 'OwnedManualExchangeQuoteNotFoundError';
  }
}

export class ManualExchangeQuoteVersionConflictError extends Error {
  public constructor() {
    super('Manual exchange quote changed concurrently.');
    this.name = 'ManualExchangeQuoteVersionConflictError';
  }
}

export class ManualExchangeQuoteIdempotencyConflictError extends Error {
  public constructor() {
    super('Idempotency key was already used for a different quote command.');
    this.name = 'ManualExchangeQuoteIdempotencyConflictError';
  }
}

export class InvalidManualExchangeQuoteIdempotencyKeyError extends Error {
  public constructor() {
    super('A valid idempotency key is required.');
    this.name = 'InvalidManualExchangeQuoteIdempotencyKeyError';
  }
}

export type CreateManualExchangeQuoteCommand = Readonly<{
  actorId: string;
  effectiveAt: Date;
  idempotencyKey: string;
  rate: string;
  source: string;
  sourceCurrencyCode: ManualQuoteCurrency;
  targetCurrencyCode: ManualQuoteCurrency;
}>;

export class CreateManualExchangeQuoteUseCase {
  public constructor(
    private readonly quotes: ManualExchangeQuoteRepository,
    private readonly clock: Clock,
    private readonly identifiers: IdentifierGenerator,
  ) {}

  public async execute(
    command: CreateManualExchangeQuoteCommand,
  ): Promise<ManualExchangeQuote> {
    validateIdempotencyKey(command.idempotencyKey);
    const previous = await this.quotes.findByIdempotencyKeyForOwner(
      command.actorId,
      'created',
      command.idempotencyKey,
    );
    if (previous !== null) return matchingCreate(previous, command);
    const at = this.clock.now();
    const quote = ManualExchangeQuote.create({
      authorId: command.actorId,
      effectiveAt: command.effectiveAt,
      id: this.identifiers.generate(),
      ownerId: command.actorId,
      rate: command.rate,
      recordedAt: at,
      source: command.source,
      sourceCurrencyCode: command.sourceCurrencyCode,
      targetCurrencyCode: command.targetCurrencyCode,
      version: 1,
    });
    const inserted = await this.quotes.insertVersion(
      quote,
      FinancialAuditEvent.create({
        action: 'created',
        actorId: command.actorId,
        id: this.identifiers.generate(),
        occurredAt: at,
        ownerId: command.actorId,
        resourceId: quote.toSnapshot().id,
        resourceType: 'manual-exchange-quote',
      }),
      command.idempotencyKey,
    );
    if (!inserted) {
      const concurrent = await this.quotes.findByIdempotencyKeyForOwner(
        command.actorId,
        'created',
        command.idempotencyKey,
      );
      if (concurrent !== null) return matchingCreate(concurrent, command);
      throw new ManualExchangeQuoteVersionConflictError();
    }
    return quote;
  }
}

export class ListOwnedManualExchangeQuotesUseCase {
  public constructor(private readonly quotes: ManualExchangeQuoteRepository) {}

  public execute(actorId: string): Promise<readonly ManualExchangeQuote[]> {
    return this.quotes.listLatestForOwner(actorId);
  }
}

export class GetOwnedManualExchangeQuoteUseCase {
  public constructor(private readonly quotes: ManualExchangeQuoteRepository) {}

  public execute(
    id: string,
    actorId: string,
  ): Promise<ManualExchangeQuote | null> {
    return this.quotes.findLatestForOwner(id, actorId);
  }
}

export class CorrectOwnedManualExchangeQuoteUseCase {
  public constructor(
    private readonly quotes: ManualExchangeQuoteRepository,
    private readonly clock: Clock,
    private readonly identifiers: IdentifierGenerator,
  ) {}

  public async execute(
    command: Readonly<{
      actorId: string;
      effectiveAt: Date;
      idempotencyKey: string;
      quoteId: string;
      rate: string;
      source: string;
    }>,
  ): Promise<ManualExchangeQuote> {
    validateIdempotencyKey(command.idempotencyKey);
    const repeated = await this.quotes.findByIdempotencyKeyForOwner(
      command.actorId,
      'updated',
      command.idempotencyKey,
    );
    if (repeated !== null) return matchingCorrection(repeated, command);
    const previous = await this.quotes.findLatestForOwner(
      command.quoteId,
      command.actorId,
    );
    if (previous === null) throw new OwnedManualExchangeQuoteNotFoundError();
    const at = this.clock.now();
    const corrected = previous.correct({
      authorId: command.actorId,
      effectiveAt: command.effectiveAt,
      rate: command.rate,
      recordedAt: at,
      source: command.source,
    });
    const inserted = await this.quotes.insertVersion(
      corrected,
      FinancialAuditEvent.create({
        action: 'updated',
        actorId: command.actorId,
        id: this.identifiers.generate(),
        occurredAt: at,
        ownerId: command.actorId,
        resourceId: command.quoteId,
        resourceType: 'manual-exchange-quote',
      }),
      command.idempotencyKey,
    );
    if (!inserted) {
      const concurrent = await this.quotes.findByIdempotencyKeyForOwner(
        command.actorId,
        'updated',
        command.idempotencyKey,
      );
      if (concurrent !== null) return matchingCorrection(concurrent, command);
      throw new ManualExchangeQuoteVersionConflictError();
    }
    return corrected;
  }
}

function validateIdempotencyKey(key: string): void {
  if (!/^[A-Za-z0-9._:-]{1,128}$/u.test(key))
    throw new InvalidManualExchangeQuoteIdempotencyKeyError();
}

function matchingCreate(
  quote: ManualExchangeQuote,
  command: CreateManualExchangeQuoteCommand,
): ManualExchangeQuote {
  const value = quote.toSnapshot();
  if (
    value.ownerId !== command.actorId ||
    value.version !== 1 ||
    value.effectiveAt.getTime() !== command.effectiveAt.getTime() ||
    value.rate !== command.rate ||
    value.source !== command.source ||
    value.sourceCurrencyCode !== command.sourceCurrencyCode ||
    value.targetCurrencyCode !== command.targetCurrencyCode
  )
    throw new ManualExchangeQuoteIdempotencyConflictError();
  return quote;
}

function matchingCorrection(
  quote: ManualExchangeQuote,
  command: Readonly<{
    actorId: string;
    effectiveAt: Date;
    quoteId: string;
    rate: string;
    source: string;
  }>,
): ManualExchangeQuote {
  const value = quote.toSnapshot();
  if (
    value.ownerId !== command.actorId ||
    value.id !== command.quoteId ||
    value.effectiveAt.getTime() !== command.effectiveAt.getTime() ||
    value.rate !== command.rate ||
    value.source !== command.source
  )
    throw new ManualExchangeQuoteIdempotencyConflictError();
  return quote;
}
