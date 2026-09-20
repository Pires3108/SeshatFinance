import { Account, AccountType, Currency, Money } from '@seshat/domain';

import type { Clock } from '../ports/clock.js';
import type { IdentifierGenerator } from '../ports/identifier-generator.js';

export type CreateAccountCommand = Readonly<{
  actorId: string;
  color: string | null;
  currencyCode: string;
  currencyMinorUnitScale: number;
  description: string | null;
  icon: string | null;
  initialBalance: string;
  institution: string | null;
  name: string;
  typeKey: string;
}>;

export interface AccountRepository {
  insert(account: Account): Promise<void>;
  findByIdForOwner(id: string, ownerId: string): Promise<Account | null>;
  listForOwner(
    ownerId: string,
    lifecycle?: Account['lifecycle'],
  ): Promise<readonly Account[]>;
  save(account: Account, expectedVersion: number): Promise<boolean>;
}

export type AccountLifecycleAction =
  'archive' | 'unarchive' | 'move-to-trash' | 'restore-from-trash';

export class OwnedAccountNotFoundError extends Error {
  public constructor() {
    super('Owned account was not found.');
    this.name = 'OwnedAccountNotFoundError';
  }
}

export class AccountVersionConflictError extends Error {
  public constructor() {
    super('Account was modified concurrently.');
    this.name = 'AccountVersionConflictError';
  }
}

export class CreateAccountUseCase {
  public constructor(
    private readonly accounts: AccountRepository,
    private readonly clock: Clock,
    private readonly identifiers: IdentifierGenerator,
  ) {}

  public async execute(command: CreateAccountCommand): Promise<Account> {
    const currency = Currency.create(
      command.currencyCode,
      command.currencyMinorUnitScale,
    );
    const account = Account.create({
      color: command.color,
      createdAt: this.clock.now(),
      description: command.description,
      icon: command.icon,
      id: this.identifiers.generate(),
      initialBalance: Money.fromDecimal(command.initialBalance, currency),
      institution: command.institution,
      name: command.name,
      ownerId: command.actorId,
      type: AccountType.create(command.typeKey),
    });
    await this.accounts.insert(account);
    return account;
  }
}

export class GetOwnedAccountUseCase {
  public constructor(private readonly accounts: AccountRepository) {}

  public execute(accountId: string, actorId: string): Promise<Account | null> {
    return this.accounts.findByIdForOwner(accountId, actorId);
  }
}

export class ListOwnedAccountsUseCase {
  public constructor(private readonly accounts: AccountRepository) {}

  public execute(
    actorId: string,
    lifecycle?: Account['lifecycle'],
  ): Promise<readonly Account[]> {
    return this.accounts.listForOwner(actorId, lifecycle);
  }
}

export type UpdateOwnedAccountDetailsCommand = Readonly<{
  accountId: string;
  actorId: string;
  color: string | null;
  description: string | null;
  icon: string | null;
  institution: string | null;
  name: string;
  typeKey: string;
}>;

export class UpdateOwnedAccountDetailsUseCase {
  public constructor(
    private readonly accounts: AccountRepository,
    private readonly clock: Clock,
  ) {}

  public async execute(
    command: UpdateOwnedAccountDetailsCommand,
  ): Promise<Account> {
    const account = await this.accounts.findByIdForOwner(
      command.accountId,
      command.actorId,
    );
    if (account === null) throw new OwnedAccountNotFoundError();
    const expectedVersion = account.toSnapshot().version;
    account.updateDetails(
      {
        color: command.color,
        description: command.description,
        icon: command.icon,
        institution: command.institution,
        name: command.name,
        type: AccountType.create(command.typeKey),
      },
      this.clock.now(),
    );
    if (!(await this.accounts.save(account, expectedVersion))) {
      throw new AccountVersionConflictError();
    }
    return account;
  }
}

export class ChangeOwnedAccountLifecycleUseCase {
  public constructor(
    private readonly accounts: AccountRepository,
    private readonly clock: Clock,
  ) {}

  public async execute(command: {
    accountId: string;
    action: AccountLifecycleAction;
    actorId: string;
  }): Promise<Account> {
    const account = await this.accounts.findByIdForOwner(
      command.accountId,
      command.actorId,
    );
    if (account === null) throw new OwnedAccountNotFoundError();
    const expectedVersion = account.toSnapshot().version;
    const at = this.clock.now();
    switch (command.action) {
      case 'archive':
        account.archive(at);
        break;
      case 'unarchive':
        account.unarchive(at);
        break;
      case 'move-to-trash':
        account.moveToTrash(at);
        break;
      case 'restore-from-trash':
        account.restoreFromTrash(at);
        break;
    }
    if (!(await this.accounts.save(account, expectedVersion))) {
      throw new AccountVersionConflictError();
    }
    return account;
  }
}
