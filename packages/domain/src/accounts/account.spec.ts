import { describe, expect, it } from 'vitest';

import { Currency } from '../money/currency.js';
import { Money } from '../money/money.js';
import { AccountType } from './account-type.js';
import { Account, AccountLifecycleError } from './account.js';

const createdAt = new Date('2026-09-20T12:00:00.000Z');

function createAccount(): Account {
  return Account.create({
    color: null,
    createdAt,
    description: null,
    icon: null,
    id: 'account-id',
    initialBalance: Money.fromDecimal('100.25', Currency.create('BRL', 2)),
    institution: null,
    name: 'Conta principal',
    ownerId: 'owner-id',
    type: AccountType.create('checking-account'),
  });
}

describe('Account', () => {
  it('creates an owned active account with exact initial balance', () => {
    const account = createAccount();

    expect(account.toSnapshot()).toMatchObject({
      id: 'account-id',
      lifecycle: 'active',
      ownerId: 'owner-id',
      version: 1,
    });
    expect(account.initialBalance.toDecimal()).toBe('100.25');
  });

  it('archives without discarding its initial financial effect', () => {
    const account = createAccount();
    const archivedAt = new Date('2026-09-20T13:00:00.000Z');

    account.archive(archivedAt);

    expect(account.toSnapshot()).toMatchObject({
      archivedAt,
      lifecycle: 'archived',
      version: 2,
    });
    expect(account.initialBalance.toDecimal()).toBe('100.25');
  });

  it('restores a trashed archived account to archived state', () => {
    const account = createAccount();
    account.archive(new Date('2026-09-20T13:00:00.000Z'));
    account.moveToTrash(new Date('2026-09-20T14:00:00.000Z'));

    account.restoreFromTrash(new Date('2026-09-20T15:00:00.000Z'));

    expect(account.toSnapshot()).toMatchObject({
      lifecycle: 'archived',
      trashedAt: null,
      version: 4,
    });
  });

  it('rejects edits while the account is in the trash', () => {
    const account = createAccount();
    account.moveToTrash(new Date('2026-09-20T13:00:00.000Z'));

    expect(() => {
      account.rename('Outra conta', new Date('2026-09-20T14:00:00.000Z'));
    }).toThrow(AccountLifecycleError);
  });

  it('updates editable details atomically', () => {
    const account = createAccount();

    account.updateDetails(
      {
        color: ' #112233 ',
        description: ' Reserva ',
        icon: ' piggy-bank ',
        institution: ' Instituição ',
        name: ' Conta reserva ',
        type: AccountType.create('savings-account'),
      },
      new Date('2026-09-20T13:00:00.000Z'),
    );

    expect(account.toSnapshot()).toMatchObject({
      color: '#112233',
      description: 'Reserva',
      icon: 'piggy-bank',
      institution: 'Instituição',
      name: 'Conta reserva',
      type: { key: 'savings-account' },
      version: 2,
    });
  });

  it('rejects stale lifecycle transitions', () => {
    const account = createAccount();

    expect(() => {
      account.archive(new Date('2026-09-20T11:00:00.000Z'));
    }).toThrow(AccountLifecycleError);
  });
});
