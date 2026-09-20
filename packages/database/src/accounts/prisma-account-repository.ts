import type { AccountRepository } from '@seshat/application';
import { Account } from '@seshat/domain';

import type { PrismaClient } from '../generated/prisma/client.js';

export class PrismaAccountRepository implements AccountRepository {
  public constructor(private readonly client: PrismaClient) {}

  public async insert(account: Account): Promise<void> {
    const snapshot = account.toSnapshot();
    await this.client.account.create({
      data: {
        archivedAt: snapshot.archivedAt,
        color: snapshot.color,
        createdAt: snapshot.createdAt,
        currencyCode: snapshot.initialBalance.currency.code,
        currencyMinorUnitScale: snapshot.initialBalance.currency.minorUnitScale,
        description: snapshot.description,
        icon: snapshot.icon,
        id: snapshot.id,
        initialBalanceMinorUnits: account.initialBalance
          .toMinorUnits()
          .toString(),
        institution: snapshot.institution,
        lifecycle: snapshot.lifecycle,
        name: snapshot.name,
        ownerId: snapshot.ownerId,
        trashedAt: snapshot.trashedAt,
        typeKey: snapshot.type.key,
        updatedAt: snapshot.updatedAt,
        version: snapshot.version,
      },
    });
  }

  public async findByIdForOwner(
    id: string,
    ownerId: string,
  ): Promise<Account | null> {
    const persisted = await this.client.account.findFirst({
      where: { id, ownerId },
    });
    if (persisted === null) return null;
    return restoreAccount(persisted);
  }

  public async listForOwner(
    ownerId: string,
    lifecycle?: Account['lifecycle'],
  ): Promise<readonly Account[]> {
    const persisted = await this.client.account.findMany({
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: 100,
      where: { ownerId, ...(lifecycle === undefined ? {} : { lifecycle }) },
    });
    return persisted.map(restoreAccount);
  }

  public async save(
    account: Account,
    expectedVersion: number,
  ): Promise<boolean> {
    const snapshot = account.toSnapshot();
    const result = await this.client.account.updateMany({
      data: {
        archivedAt: snapshot.archivedAt,
        color: snapshot.color,
        description: snapshot.description,
        icon: snapshot.icon,
        institution: snapshot.institution,
        lifecycle: snapshot.lifecycle,
        name: snapshot.name,
        trashedAt: snapshot.trashedAt,
        typeKey: snapshot.type.key,
        updatedAt: snapshot.updatedAt,
        version: snapshot.version,
      },
      where: {
        id: snapshot.id,
        ownerId: snapshot.ownerId,
        version: expectedVersion,
      },
    });
    return result.count === 1;
  }
}

type PersistedAccount =
  Awaited<ReturnType<PrismaClient['account']['findFirst']>> extends infer Result
    ? Exclude<Result, null>
    : never;

function restoreAccount(persisted: PersistedAccount): Account {
  return Account.restore({
    archivedAt: persisted.archivedAt,
    color: persisted.color,
    createdAt: persisted.createdAt,
    description: persisted.description,
    icon: persisted.icon,
    id: persisted.id,
    initialBalance: {
      amount: decimalFromMinorUnits(
        persisted.initialBalanceMinorUnits.toFixed(0),
        persisted.currencyMinorUnitScale,
      ),
      currency: {
        code: persisted.currencyCode,
        minorUnitScale: persisted.currencyMinorUnitScale,
      },
    },
    institution: persisted.institution,
    lifecycle: persisted.lifecycle,
    name: persisted.name,
    ownerId: persisted.ownerId,
    trashedAt: persisted.trashedAt,
    type: { key: persisted.typeKey },
    updatedAt: persisted.updatedAt,
    version: persisted.version,
  });
}

function decimalFromMinorUnits(minorUnits: string, scale: number): string {
  const negative = minorUnits.startsWith('-');
  const digits = negative ? minorUnits.slice(1) : minorUnits;
  if (scale === 0) return minorUnits;
  const padded = digits.padStart(scale + 1, '0');
  const sign = negative ? '-' : '';
  return `${sign}${padded.slice(0, -scale)}.${padded.slice(-scale)}`;
}
