import type { Account } from '@seshat/domain';
import { describe, expect, it } from 'vitest';

import type { Clock } from '../ports/clock.js';
import type { IdentifierGenerator } from '../ports/identifier-generator.js';
import {
  AccountVersionConflictError,
  ChangeOwnedAccountLifecycleUseCase,
  type AccountRepository,
  CreateAccountUseCase,
  GetOwnedAccountUseCase,
  ListOwnedAccountsUseCase,
  UpdateOwnedAccountDetailsUseCase,
} from './create-account.js';

class RecordingAccountRepository implements AccountRepository {
  public inserted: Account | undefined;
  public persistedVersion: number | undefined;
  public forceConflict = false;

  public insert(account: Account): Promise<void> {
    this.inserted = account;
    this.persistedVersion = account.toSnapshot().version;
    return Promise.resolve();
  }

  public findByIdForOwner(
    id: string,
    ownerId: string,
  ): Promise<Account | null> {
    const account = this.inserted;
    return Promise.resolve(
      account?.id === id && account.ownerId === ownerId ? account : null,
    );
  }

  public save(account: Account, expectedVersion: number): Promise<boolean> {
    if (this.forceConflict || this.persistedVersion !== expectedVersion) {
      return Promise.resolve(false);
    }
    this.inserted = account;
    this.persistedVersion = account.toSnapshot().version;
    return Promise.resolve(true);
  }

  public listForOwner(
    ownerId: string,
    lifecycle?: Account['lifecycle'],
  ): Promise<readonly Account[]> {
    const account = this.inserted;
    if (
      account?.ownerId !== ownerId ||
      (lifecycle !== undefined && account.lifecycle !== lifecycle)
    ) {
      return Promise.resolve([]);
    }
    return Promise.resolve([account]);
  }
}

describe('CreateAccountUseCase', () => {
  it('uses the authenticated actor, injected clock, and injected identifier', async () => {
    const repository = new RecordingAccountRepository();
    const instant = new Date('2026-09-20T12:00:00.000Z');
    const clock: Clock = { now: (): Date => new Date(instant) };
    const identifiers: IdentifierGenerator = {
      generate: (): string => '7c2c7a54-73fe-49a3-b0ea-19034bf22baf',
    };
    const useCase = new CreateAccountUseCase(repository, clock, identifiers);

    const account = await useCase.execute({
      actorId: 'owner-id',
      color: null,
      currencyCode: 'BRL',
      currencyMinorUnitScale: 2,
      description: null,
      icon: null,
      initialBalance: '125.30',
      institution: null,
      name: 'Conta principal',
      typeKey: 'checking-account',
    });

    expect(account.toSnapshot()).toMatchObject({
      createdAt: instant,
      id: '7c2c7a54-73fe-49a3-b0ea-19034bf22baf',
      ownerId: 'owner-id',
    });
    expect(repository.inserted?.initialBalance.toDecimal()).toBe('125.30');
  });
});

describe('GetOwnedAccountUseCase', () => {
  it('does not return another actor account', async () => {
    const repository = new RecordingAccountRepository();
    const create = new CreateAccountUseCase(
      repository,
      { now: (): Date => new Date('2026-09-20T12:00:00.000Z') },
      { generate: (): string => 'account-id' },
    );
    await create.execute({
      actorId: 'owner-id',
      color: null,
      currencyCode: 'BRL',
      currencyMinorUnitScale: 2,
      description: null,
      icon: null,
      initialBalance: '0',
      institution: null,
      name: 'Conta',
      typeKey: 'checking-account',
    });
    const get = new GetOwnedAccountUseCase(repository);

    await expect(get.execute('account-id', 'other-owner')).resolves.toBeNull();
  });
});

describe('ListOwnedAccountsUseCase', () => {
  it('delegates ownership and lifecycle filtering to the repository', async () => {
    const repository = new RecordingAccountRepository();
    const list = new ListOwnedAccountsUseCase(repository);

    await expect(list.execute('other-owner')).resolves.toEqual([]);
    await expect(list.execute('owner-id', 'archived')).resolves.toEqual([]);
  });
});

describe('UpdateOwnedAccountDetailsUseCase', () => {
  it('updates all editable details as one versioned change', async () => {
    const repository = new RecordingAccountRepository();
    await new CreateAccountUseCase(
      repository,
      { now: (): Date => new Date('2026-09-20T12:00:00.000Z') },
      { generate: (): string => 'account-id' },
    ).execute({
      actorId: 'owner-id',
      color: null,
      currencyCode: 'BRL',
      currencyMinorUnitScale: 2,
      description: null,
      icon: null,
      initialBalance: '0',
      institution: null,
      name: 'Conta',
      typeKey: 'checking-account',
    });
    const update = new UpdateOwnedAccountDetailsUseCase(repository, {
      now: (): Date => new Date('2026-09-20T13:00:00.000Z'),
    });

    const result = await update.execute({
      accountId: 'account-id',
      actorId: 'owner-id',
      color: '#112233',
      description: 'Reserva mensal',
      icon: 'piggy-bank',
      institution: 'Instituição',
      name: 'Reserva',
      typeKey: 'savings-account',
    });

    expect(result.toSnapshot()).toMatchObject({
      color: '#112233',
      description: 'Reserva mensal',
      icon: 'piggy-bank',
      institution: 'Instituição',
      name: 'Reserva',
      type: { key: 'savings-account' },
      version: 2,
    });
  });
});

describe('ChangeOwnedAccountLifecycleUseCase', () => {
  it('persists an owned lifecycle transition with the expected version', async () => {
    const repository = new RecordingAccountRepository();
    const create = new CreateAccountUseCase(
      repository,
      { now: (): Date => new Date('2026-09-20T12:00:00.000Z') },
      { generate: (): string => 'account-id' },
    );
    await create.execute({
      actorId: 'owner-id',
      color: null,
      currencyCode: 'BRL',
      currencyMinorUnitScale: 2,
      description: null,
      icon: null,
      initialBalance: '0',
      institution: null,
      name: 'Conta',
      typeKey: 'checking-account',
    });
    const change = new ChangeOwnedAccountLifecycleUseCase(repository, {
      now: (): Date => new Date('2026-09-20T13:00:00.000Z'),
    });

    const result = await change.execute({
      accountId: 'account-id',
      action: 'archive',
      actorId: 'owner-id',
    });

    expect(result.toSnapshot()).toMatchObject({
      lifecycle: 'archived',
      version: 2,
    });
  });

  it('reports an optimistic concurrency conflict', async () => {
    const repository = new RecordingAccountRepository();
    await new CreateAccountUseCase(
      repository,
      { now: (): Date => new Date('2026-09-20T12:00:00.000Z') },
      { generate: (): string => 'account-id' },
    ).execute({
      actorId: 'owner-id',
      color: null,
      currencyCode: 'BRL',
      currencyMinorUnitScale: 2,
      description: null,
      icon: null,
      initialBalance: '0',
      institution: null,
      name: 'Conta',
      typeKey: 'checking-account',
    });
    repository.forceConflict = true;
    const change = new ChangeOwnedAccountLifecycleUseCase(repository, {
      now: (): Date => new Date('2026-09-20T13:00:00.000Z'),
    });

    await expect(
      change.execute({
        accountId: 'account-id',
        action: 'archive',
        actorId: 'owner-id',
      }),
    ).rejects.toBeInstanceOf(AccountVersionConflictError);
  });
});
