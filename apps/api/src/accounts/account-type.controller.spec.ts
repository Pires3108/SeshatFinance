import { ListDefaultAccountTypesUseCase } from '@seshat/application';
import { describe, expect, it } from 'vitest';

import { AccountTypeController } from './account-type.controller.js';

describe('AccountTypeController', () => {
  it('presents all default types with pt-BR labels', () => {
    const controller = new AccountTypeController(
      new ListDefaultAccountTypesUseCase(),
    );

    expect(controller.list()).toEqual([
      { key: 'checking-account', label: 'Conta corrente' },
      { key: 'savings-account', label: 'Poupança' },
      { key: 'cash-wallet', label: 'Carteira em dinheiro' },
      { key: 'reserve', label: 'Reserva' },
      { key: 'credit-card', label: 'Cartão de crédito' },
      { key: 'investment-account', label: 'Conta de investimento' },
    ]);
  });
});
