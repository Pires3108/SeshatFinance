import { ListInvestmentTypesUseCase } from '@seshat/application';
import { describe, expect, it } from 'vitest';

import { InvestmentTypeController } from './investment-type.controller.js';

describe('InvestmentTypeController', () => {
  it('presents all supported types with pt-BR labels', () => {
    const controller = new InvestmentTypeController(
      new ListInvestmentTypesUseCase(),
    );

    expect(controller.list()).toEqual([
      { key: 'treasury-direct', label: 'Tesouro Direto' },
      { key: 'cdb', label: 'CDB' },
      { key: 'lci', label: 'LCI' },
      { key: 'lca', label: 'LCA' },
      { key: 'savings', label: 'Poupança' },
      { key: 'stock', label: 'Ações' },
      { key: 'fii', label: 'FIIs' },
      { key: 'etf', label: 'ETFs' },
      { key: 'cryptocurrency', label: 'Criptomoedas' },
      { key: 'investment-fund', label: 'Fundos' },
      { key: 'private-pension', label: 'Previdência privada' },
    ]);
  });
});
