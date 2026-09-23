import { describe, expect, it } from 'vitest';

import {
  AccountType,
  InvalidAccountTypeError,
  defaultAccountTypeKeys,
} from './account-type.js';

describe('AccountType', () => {
  it('supports built-in and configurable stable keys', () => {
    expect(AccountType.create('checking-account').key).toBe('checking-account');
    expect(AccountType.create('employee-benefit').key).toBe('employee-benefit');
  });

  it('rejects labels used as unstable identifiers', () => {
    expect(() => AccountType.create('Conta Corrente')).toThrow(
      InvalidAccountTypeError,
    );
  });

  it('lists every default type while still allowing custom keys', () => {
    expect(defaultAccountTypeKeys).toEqual([
      'checking-account',
      'savings-account',
      'cash-wallet',
      'reserve',
      'credit-card',
      'investment-account',
    ]);
    expect(
      defaultAccountTypeKeys.map((key) => AccountType.create(key).key),
    ).toEqual(defaultAccountTypeKeys);
    expect(AccountType.create('employee-benefit').key).toBe('employee-benefit');
  });
});
