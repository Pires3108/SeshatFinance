import { describe, expect, it } from 'vitest';

import { ListDefaultAccountTypesUseCase } from './list-default-account-types.js';

describe('ListDefaultAccountTypesUseCase', () => {
  it('returns the supported default account types', () => {
    expect(
      new ListDefaultAccountTypesUseCase().execute().map((type) => type.key),
    ).toEqual([
      'checking-account',
      'savings-account',
      'cash-wallet',
      'reserve',
      'credit-card',
      'investment-account',
    ]);
  });
});
