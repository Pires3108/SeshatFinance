import type {
  ChangeOwnedAccountLifecycleUseCase,
  CreateAccountUseCase,
  GetOwnedAccountUseCase,
} from '@seshat/application';
import { Account, AccountType, Currency, Money } from '@seshat/domain';
import type { FastifyRequest } from 'fastify';
import { describe, expect, it, vi } from 'vitest';

import { AuthenticatedActorContext } from '../auth/authenticated-actor-context.js';
import { AccountController } from './account.controller.js';

function account(): Account {
  return Account.create({
    color: null,
    createdAt: new Date('2026-09-20T12:00:00.000Z'),
    description: null,
    icon: null,
    id: '7c2c7a54-73fe-49a3-b0ea-19034bf22baf',
    initialBalance: Money.fromDecimal('10.25', Currency.create('BRL', 2)),
    institution: null,
    name: 'Conta',
    ownerId: 'actor-id',
    type: AccountType.create('checking-account'),
  });
}

function request(actors: AuthenticatedActorContext): FastifyRequest {
  const value = {} as FastifyRequest;
  actors.set(value, { id: 'actor-id' });
  return value;
}

describe('AccountController', () => {
  it('derives account ownership from the verified actor', async () => {
    const actors = new AuthenticatedActorContext();
    const execute = vi.fn().mockResolvedValue(account());
    const controller = new AccountController(
      { execute } as unknown as CreateAccountUseCase,
      { execute: vi.fn() } as unknown as GetOwnedAccountUseCase,
      { execute: vi.fn() } as unknown as ChangeOwnedAccountLifecycleUseCase,
      actors,
    );

    await controller.create(request(actors), {
      color: null,
      currencyCode: 'BRL',
      currencyMinorUnitScale: 2,
      description: null,
      icon: null,
      initialBalance: '10.25',
      institution: null,
      name: 'Conta',
      typeKey: 'checking-account',
    });

    expect(execute).toHaveBeenCalledWith({
      actorId: 'actor-id',
      color: null,
      currencyCode: 'BRL',
      currencyMinorUnitScale: 2,
      description: null,
      icon: null,
      initialBalance: '10.25',
      institution: null,
      name: 'Conta',
      typeKey: 'checking-account',
    });
  });

  it('queries by both account and verified actor identifiers', async () => {
    const actors = new AuthenticatedActorContext();
    const execute = vi.fn().mockResolvedValue(account());
    const controller = new AccountController(
      { execute: vi.fn() } as unknown as CreateAccountUseCase,
      { execute } as unknown as GetOwnedAccountUseCase,
      { execute: vi.fn() } as unknown as ChangeOwnedAccountLifecycleUseCase,
      actors,
    );

    await controller.get(
      request(actors),
      '7c2c7a54-73fe-49a3-b0ea-19034bf22baf',
    );

    expect(execute).toHaveBeenCalledWith(
      '7c2c7a54-73fe-49a3-b0ea-19034bf22baf',
      'actor-id',
    );
  });
});
