const accountTypeKeyPattern = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;

export const defaultAccountTypeKeys = [
  'checking-account',
  'savings-account',
  'cash-wallet',
  'reserve',
  'credit-card',
  'investment-account',
] as const;

export type DefaultAccountTypeKey = (typeof defaultAccountTypeKeys)[number];

export type AccountTypeSnapshot = Readonly<{
  key: string;
}>;

export class InvalidAccountTypeError extends Error {
  public constructor() {
    super('Account type key must use non-empty kebab-case.');
    this.name = 'InvalidAccountTypeError';
  }
}

export class AccountType {
  private constructor(public readonly key: string) {}

  public static create(key: string): AccountType {
    if (!accountTypeKeyPattern.test(key)) {
      throw new InvalidAccountTypeError();
    }
    return new AccountType(key);
  }

  public static restore(snapshot: AccountTypeSnapshot): AccountType {
    return AccountType.create(snapshot.key);
  }

  public equals(other: AccountType): boolean {
    return this.key === other.key;
  }

  public toSnapshot(): AccountTypeSnapshot {
    return { key: this.key };
  }
}
