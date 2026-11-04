export type Transaction = Readonly<{
  id: string;
  accountId: string;
  amount: string;
  currencyCode: string;
  currencyMinorUnitScale: number;
  kind: 'income' | 'expense';
  occurredAt: string;
  description: string | null;
  observations: string | null;
  counterpartyId: string | null;
  counterpartyName: string | null;
  categoryId: string | null;
  subcategoryId: string | null;
  costCenterId: string | null;
  tagIds: readonly string[];
  version: number;
  lifecycle: 'active' | 'archived' | 'trashed';
}>;

export const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export function isTransaction(value: unknown): value is Transaction {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.id === 'string' &&
    uuid.test(item.id) &&
    typeof item.accountId === 'string' &&
    uuid.test(item.accountId) &&
    typeof item.amount === 'string' &&
    /^\d+(?:\.\d+)?$/u.test(item.amount) &&
    typeof item.currencyCode === 'string' &&
    /^[A-Z]{3}$/u.test(item.currencyCode) &&
    typeof item.currencyMinorUnitScale === 'number' &&
    Number.isInteger(item.currencyMinorUnitScale) &&
    item.currencyMinorUnitScale >= 0 &&
    item.currencyMinorUnitScale <= 18 &&
    (item.amount.split('.')[1]?.length ?? 0) <= item.currencyMinorUnitScale &&
    (item.kind === 'income' || item.kind === 'expense') &&
    typeof item.occurredAt === 'string' &&
    !Number.isNaN(Date.parse(item.occurredAt)) &&
    (item.description === null || typeof item.description === 'string') &&
    (item.observations === null || typeof item.observations === 'string') &&
    (item.counterpartyId === null ||
      (typeof item.counterpartyId === 'string' &&
        uuid.test(item.counterpartyId))) &&
    (item.counterpartyName === null ||
      typeof item.counterpartyName === 'string') &&
    (item.categoryId === null ||
      (typeof item.categoryId === 'string' && uuid.test(item.categoryId))) &&
    (item.subcategoryId === null ||
      (typeof item.subcategoryId === 'string' &&
        uuid.test(item.subcategoryId))) &&
    (item.costCenterId === null ||
      (typeof item.costCenterId === 'string' &&
        uuid.test(item.costCenterId))) &&
    Array.isArray(item.tagIds) &&
    item.tagIds.every(
      (id: unknown) => typeof id === 'string' && uuid.test(id),
    ) &&
    typeof item.version === 'number' &&
    Number.isInteger(item.version) &&
    item.version > 0 &&
    (item.lifecycle === 'active' ||
      item.lifecycle === 'archived' ||
      item.lifecycle === 'trashed')
  );
}

export function validAmount(value: string, scale: number): boolean {
  return (
    /^\d+(?:[.,]\d+)?$/u.test(value) &&
    (value.split(/[.,]/u)[1]?.length ?? 0) <= scale &&
    /[1-9]/u.test(value)
  );
}
