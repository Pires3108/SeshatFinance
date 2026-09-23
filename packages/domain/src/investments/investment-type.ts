export const investmentTypeKeys = [
  'treasury-direct',
  'cdb',
  'lci',
  'lca',
  'savings',
  'stock',
  'fii',
  'etf',
  'cryptocurrency',
  'investment-fund',
  'private-pension',
] as const;

export type InvestmentTypeKey = (typeof investmentTypeKeys)[number];
export type InvestmentTypeSnapshot = Readonly<{ key: InvestmentTypeKey }>;

const allowedKeys: ReadonlySet<string> = new Set(investmentTypeKeys);

export class InvalidInvestmentTypeError extends Error {
  public constructor() {
    super('Investment type is not in the supported catalogue.');
    this.name = 'InvalidInvestmentTypeError';
  }
}

export class InvestmentType {
  private constructor(public readonly key: InvestmentTypeKey) {}

  public static create(key: string): InvestmentType {
    if (!allowedKeys.has(key)) throw new InvalidInvestmentTypeError();
    return new InvestmentType(key as InvestmentTypeKey);
  }

  public static restore(snapshot: InvestmentTypeSnapshot): InvestmentType {
    return InvestmentType.create(snapshot.key);
  }

  public equals(other: InvestmentType): boolean {
    return this.key === other.key;
  }

  public toSnapshot(): InvestmentTypeSnapshot {
    return { key: this.key };
  }
}
