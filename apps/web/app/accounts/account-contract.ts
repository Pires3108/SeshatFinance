import type { paths } from '@seshat/contracts';

type ListResponse =
  paths['/api/v1/accounts']['get']['responses'][200]['content']['application/json'];
type BalanceResponse =
  paths['/api/v1/accounts/{accountId}/balance']['get']['responses'][200]['content']['application/json'];

type ApiAccount = ListResponse[number];
export type Account = Pick<
  ApiAccount,
  | 'id'
  | 'name'
  | 'typeKey'
  | 'lifecycle'
  | 'currencyCode'
  | 'currencyMinorUnitScale'
>;
export type AccountBalance = BalanceResponse;
export type AccountWithBalance = Readonly<{
  account: Account;
  balance: AccountBalance;
}>;
export type Lifecycle = Account['lifecycle'];
export type LifecycleAction =
  paths['/api/v1/accounts/{accountId}/lifecycle']['patch']['requestBody']['content']['application/json']['action'];

export function isAccount(value: unknown): value is Account {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.id === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      item.id,
    ) &&
    typeof item.name === 'string' &&
    typeof item.typeKey === 'string' &&
    typeof item.currencyCode === 'string' &&
    /^[A-Z]{3}$/u.test(item.currencyCode) &&
    typeof item.currencyMinorUnitScale === 'number' &&
    Number.isInteger(item.currencyMinorUnitScale) &&
    item.currencyMinorUnitScale >= 0 &&
    item.currencyMinorUnitScale <= 18 &&
    (item.lifecycle === 'active' ||
      item.lifecycle === 'archived' ||
      item.lifecycle === 'trashed')
  );
}

export function projectAccount(value: Account): Account {
  return {
    id: value.id,
    name: value.name,
    typeKey: value.typeKey,
    lifecycle: value.lifecycle,
    currencyCode: value.currencyCode,
    currencyMinorUnitScale: value.currencyMinorUnitScale,
  };
}

export function isBalance(value: unknown): value is AccountBalance {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.amount === 'string' &&
    /^-?\d+(?:\.\d+)?$/u.test(item.amount) &&
    typeof item.currencyCode === 'string' &&
    /^[A-Z]{3}$/u.test(item.currencyCode) &&
    typeof item.currencyMinorUnitScale === 'number' &&
    Number.isInteger(item.currencyMinorUnitScale) &&
    item.currencyMinorUnitScale >= 0 &&
    item.currencyMinorUnitScale <= 18 &&
    (item.amount.split('.')[1]?.length ?? 0) <= item.currencyMinorUnitScale
  );
}

export function isAccountWithBalance(
  value: unknown,
): value is AccountWithBalance {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return false;
  const item = value as Record<string, unknown>;
  return (
    isAccount(item.account) &&
    isBalance(item.balance) &&
    item.account.currencyCode === item.balance.currencyCode &&
    item.account.currencyMinorUnitScale === item.balance.currencyMinorUnitScale
  );
}
