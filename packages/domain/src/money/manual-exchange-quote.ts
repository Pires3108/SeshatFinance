export const manualQuoteCurrencies = ['BRL', 'USD', 'EUR'] as const;

export type ManualQuoteCurrency = (typeof manualQuoteCurrencies)[number];

export function manualQuoteCurrency(code: string): ManualQuoteCurrency {
  if (code !== 'BRL' && code !== 'USD' && code !== 'EUR')
    throw new InvalidManualExchangeQuoteError('Unsupported quote currency.');
  return code;
}

export type ManualExchangeQuoteSnapshot = Readonly<{
  authorId: string;
  effectiveAt: Date;
  id: string;
  ownerId: string;
  rate: string;
  recordedAt: Date;
  source: string;
  sourceCurrencyCode: ManualQuoteCurrency;
  targetCurrencyCode: ManualQuoteCurrency;
  version: number;
}>;

export class InvalidManualExchangeQuoteError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'InvalidManualExchangeQuoteError';
  }
}

export class ManualExchangeQuote {
  private constructor(private readonly state: ManualExchangeQuoteSnapshot) {}

  public static create(
    snapshot: ManualExchangeQuoteSnapshot,
  ): ManualExchangeQuote {
    validate(snapshot);
    return new ManualExchangeQuote(copy(snapshot));
  }

  public static restore(
    snapshot: ManualExchangeQuoteSnapshot,
  ): ManualExchangeQuote {
    return ManualExchangeQuote.create(snapshot);
  }

  public correct(
    properties: Readonly<{
      authorId: string;
      effectiveAt: Date;
      rate: string;
      recordedAt: Date;
      source: string;
    }>,
  ): ManualExchangeQuote {
    return ManualExchangeQuote.create({
      ...this.state,
      ...properties,
      version: this.state.version + 1,
    });
  }

  public toSnapshot(): ManualExchangeQuoteSnapshot {
    return copy(this.state);
  }
}

function validate(snapshot: ManualExchangeQuoteSnapshot): void {
  if (
    snapshot.id.trim() === '' ||
    snapshot.ownerId.trim() === '' ||
    snapshot.authorId.trim() === ''
  )
    throw new InvalidManualExchangeQuoteError('Identifiers are required.');
  if (
    !manualQuoteCurrencies.includes(snapshot.sourceCurrencyCode) ||
    !manualQuoteCurrencies.includes(snapshot.targetCurrencyCode) ||
    snapshot.sourceCurrencyCode === snapshot.targetCurrencyCode
  )
    throw new InvalidManualExchangeQuoteError(
      'Distinct supported currencies are required.',
    );
  if (
    !/^(?:0|[1-9]\d*)(?:\.\d+)?$/u.test(snapshot.rate) ||
    snapshot.rate.length > 1000 ||
    !/[1-9]/u.test(snapshot.rate)
  )
    throw new InvalidManualExchangeQuoteError(
      'Rate must be a positive plain decimal string.',
    );
  if (snapshot.source.trim().length === 0 || snapshot.source.length > 120)
    throw new InvalidManualExchangeQuoteError('A declared source is required.');
  if (
    Number.isNaN(snapshot.effectiveAt.getTime()) ||
    Number.isNaN(snapshot.recordedAt.getTime())
  )
    throw new InvalidManualExchangeQuoteError('Valid instants are required.');
  if (!Number.isSafeInteger(snapshot.version) || snapshot.version < 1)
    throw new InvalidManualExchangeQuoteError(
      'Version must be a positive integer.',
    );
}

function copy(
  snapshot: ManualExchangeQuoteSnapshot,
): ManualExchangeQuoteSnapshot {
  return {
    ...snapshot,
    effectiveAt: new Date(snapshot.effectiveAt),
    recordedAt: new Date(snapshot.recordedAt),
  };
}
