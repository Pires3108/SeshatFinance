import {
  Account,
  AccountType,
  Currency,
  FinancialAuditEvent,
  Money,
} from '@seshat/domain';

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
  insert(account: Account, auditEvent: FinancialAuditEvent): Promise<void>;
  findByIdForOwner(id: string, ownerId: string): Promise<Account | null>;
  listForOwner(
    ownerId: string,
    lifecycle?: Account['lifecycle'],
  ): Promise<readonly Account[]>;
  save(
    account: Account,
    expectedVersion: number,
    auditEvent: FinancialAuditEvent,
  ): Promise<boolean>;
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
    const at = this.clock.now();
    const account = Account.create({
      color: command.color,
      createdAt: at,
      description: command.description,
      icon: command.icon,
      id: this.identifiers.generate(),
      initialBalance: Money.fromDecimal(command.initialBalance, currency),
      institution: command.institution,
      name: command.name,
      ownerId: command.actorId,
      type: AccountType.create(command.typeKey),
    });
    await this.accounts.insert(
      account,
      FinancialAuditEvent.create({
        action: 'created',
        actorId: command.actorId,
        id: this.identifiers.generate(),
        occurredAt: at,
        ownerId: command.actorId,
        resourceId: account.id,
        resourceType: 'account',
      }),
    );
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
    private readonly identifiers: IdentifierGenerator,
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
    const at = this.clock.now();
    account.updateDetails(
      {
        color: command.color,
        description: command.description,
        icon: command.icon,
        institution: command.institution,
        name: command.name,
        type: AccountType.create(command.typeKey),
      },
      at,
    );
    if (
      !(await this.accounts.save(
        account,
        expectedVersion,
        FinancialAuditEvent.create({
          action: 'updated',
          actorId: command.actorId,
          id: this.identifiers.generate(),
          occurredAt: at,
          ownerId: command.actorId,
          resourceId: account.id,
          resourceType: 'account',
        }),
      ))
    ) {
      throw new AccountVersionConflictError();
    }
    return account;
  }
}

export class ChangeOwnedAccountLifecycleUseCase {
  public constructor(
    private readonly accounts: AccountRepository,
    private readonly clock: Clock,
    private readonly identifiers: IdentifierGenerator,
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
    if (
      !(await this.accounts.save(
        account,
        expectedVersion,
        FinancialAuditEvent.create({
          action: lifecycleAuditAction(command.action),
          actorId: command.actorId,
          id: this.identifiers.generate(),
          occurredAt: at,
          ownerId: command.actorId,
          resourceId: account.id,
          resourceType: 'account',
        }),
      ))
    ) {
      throw new AccountVersionConflictError();
    }
    return account;
  }
}

function lifecycleAuditAction(
  action: AccountLifecycleAction,
): 'archived' | 'unarchived' | 'moved-to-trash' | 'restored-from-trash' {
  switch (action) {
    case 'archive':
      return 'archived';
    case 'unarchive':
      return 'unarchived';
    case 'move-to-trash':
      return 'moved-to-trash';
    case 'restore-from-trash':
      return 'restored-from-trash';
  }
}
