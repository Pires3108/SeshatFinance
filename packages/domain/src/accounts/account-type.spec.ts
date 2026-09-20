import { describe, expect, it } from 'vitest';

import { AccountType, InvalidAccountTypeError } from './account-type.js';

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
});
