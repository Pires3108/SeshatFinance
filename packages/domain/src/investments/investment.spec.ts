import { describe, expect, it } from 'vitest';

import { CivilDate } from '../calendar/civil-date.js';
import { Currency } from '../money/currency.js';
import {
  InvalidInvestmentError,
  Investment,
  InvestmentLifecycleError,
  investmentQuantityScale,
  parseDecimal,
  type InvestmentDetails,
} from './investment.js';
import { InvestmentType, investmentTypeKeys } from './investment-type.js';

const brl = Currency.create('BRL', 2);
const usd = Currency.create('USD', 2);
const created = new Date('2026-11-26T12:00:00.000Z');
const later = new Date('2026-11-27T12:00:00.000Z');

const cdb: InvestmentDetails = {
  type: InvestmentType.create('cdb'),
  institution: '  Banco Exemplo  ',
  name: ' CDB 2028 ',
  code: ' cdb-28 ',
  currency: brl,
  startDate: CivilDate.parse('2026-01-10'),
  maturityDate: CivilDate.parse('2028-01-10'),
  contractedRate: { indexer: 'cdi', percent: '110.00' },
  liquidity: { kind: 'at-maturity' },
};

function create(details: Partial<InvestmentDetails> = {}): Investment {
  return Investment.create({
    ...cdb,
    ...details,
    id: 'investment-id',
    ownerId: 'owner-id',
    createdAt: created,
  });
}

describe('Investment', () => {
  it('registers an active investment with normalized descriptive data', () => {
    expect(create().toSnapshot()).toEqual({
      id: 'investment-id',
      ownerId: 'owner-id',
      type: 'cdb',
      institution: 'Banco Exemplo',
      name: 'CDB 2028',
      code: 'CDB-28',
      currency: brl.toSnapshot(),
      startDate: '2026-01-10',
      maturityDate: '2028-01-10',
      contractedRate: { indexer: 'cdi', percent: '110' },
      liquidity: { kind: 'at-maturity' },
      lifecycle: 'active',
      createdAt: created,
      updatedAt: created,
      version: 1,
    });
  });

  it('accepts every type of the supported catalogue', () => {
    for (const key of investmentTypeKeys) {
      expect(
        create({
          type: InvestmentType.create(key),
          liquidity: { kind: 'daily' },
        }).type,
      ).toBe(key);
    }
  });

  it('declares the quantity scale per type (RN-072)', () => {
    expect(investmentQuantityScale('stock')).toBe(0);
    expect(investmentQuantityScale('fii')).toBe(0);
    expect(investmentQuantityScale('etf')).toBe(0);
    expect(investmentQuantityScale('cryptocurrency')).toBe(8);
    expect(investmentQuantityScale('investment-fund')).toBe(6);
    expect(investmentQuantityScale('private-pension')).toBe(6);
    expect(investmentQuantityScale('treasury-direct')).toBe(2);
    expect(investmentQuantityScale('cdb')).toBeNull();
    expect(investmentQuantityScale('savings')).toBeNull();
  });

  it('rejects inconsistent dates and liquidity', () => {
    expect(() =>
      create({ maturityDate: CivilDate.parse('2025-12-31') }),
    ).toThrow(InvalidInvestmentError);
    expect(() =>
      create({ maturityDate: null, liquidity: { kind: 'at-maturity' } }),
    ).toThrow(InvalidInvestmentError);
    expect(() => create({ liquidity: { kind: 'd-plus', days: -1 } })).toThrow(
      InvalidInvestmentError,
    );
    expect(() => create({ liquidity: { kind: 'd-plus', days: 1.5 } })).toThrow(
      InvalidInvestmentError,
    );
    expect(
      create({ liquidity: { kind: 'd-plus', days: 30 } }).toSnapshot(),
    ).toMatchObject({ liquidity: { kind: 'd-plus', days: 30 } });
  });

  it('rejects blank or oversized text and invalid codes', () => {
    expect(() => create({ institution: '   ' })).toThrow(
      InvalidInvestmentError,
    );
    expect(() => create({ name: 'x'.repeat(121) })).toThrow(
      InvalidInvestmentError,
    );
    expect(() => create({ code: 'PETR 4' })).toThrow(InvalidInvestmentError);
    expect(create({ code: '   ' }).toSnapshot().code).toBeNull();
  });

  it('keeps the contracted rate as a descriptive decimal string', () => {
    expect(() =>
      create({ contractedRate: { indexer: 'ipca', percent: '6,5' } }),
    ).toThrow(InvalidInvestmentError);
    expect(() =>
      create({ contractedRate: { indexer: 'ipca', percent: '-1' } }),
    ).toThrow(InvalidInvestmentError);
    expect(() =>
      create({ contractedRate: { indexer: 'ipca', percent: '6.12345' } }),
    ).toThrow(InvalidInvestmentError);
    expect(
      create({
        contractedRate: { indexer: 'ipca', percent: '06.50' },
      }).toSnapshot().contractedRate,
    ).toEqual({ indexer: 'ipca', percent: '6.5' });
  });

  it('edits descriptive data but keeps type and currency fixed', () => {
    const investment = create();
    investment.update({ ...cdb, name: 'CDB Liquidez' }, later);
    expect(investment.toSnapshot()).toMatchObject({
      name: 'CDB Liquidez',
      version: 2,
      updatedAt: later,
    });
    expect(() => {
      investment.update({ ...cdb, type: InvestmentType.create('lci') }, later);
    }).toThrow(InvalidInvestmentError);
    expect(() => {
      investment.update({ ...cdb, currency: usd }, later);
    }).toThrow(InvalidInvestmentError);
  });

  it('moves through archive and trash and blocks edits outside active', () => {
    const investment = create();
    investment.archive(later);
    expect(investment.lifecycle).toBe('archived');
    expect(() => {
      investment.update(cdb, later);
    }).toThrow(InvestmentLifecycleError);
    investment.unarchive(later);
    investment.trash(later);
    expect(investment.lifecycle).toBe('trashed');
    expect(() => {
      investment.trash(later);
    }).toThrow(InvestmentLifecycleError);
    expect(() => {
      investment.archive(later);
    }).toThrow(InvestmentLifecycleError);
    investment.restoreFromTrash(later);
    expect(investment.toSnapshot()).toMatchObject({
      lifecycle: 'active',
      version: 5,
    });
  });

  it('rejects a change that precedes the last one', () => {
    const investment = create();
    expect(() => {
      investment.archive(new Date('2026-11-25T12:00:00.000Z'));
    }).toThrow(InvalidInvestmentError);
  });

  it('round-trips through a snapshot', () => {
    const snapshot = create().toSnapshot();
    expect(Investment.restore(snapshot).toSnapshot()).toEqual(snapshot);
    expect(() => Investment.restore({ ...snapshot, version: 0 })).toThrow(
      InvalidInvestmentError,
    );
  });
});

describe('parseDecimal', () => {
  it('normalizes plain decimals within the scale', () => {
    expect(parseDecimal('0010.500', 8, 'price', { allowZero: false })).toBe(
      '10.5',
    );
    expect(
      parseDecimal('0.00000001', 8, 'quantity', { allowZero: false }),
    ).toBe('0.00000001');
    expect(parseDecimal('0', 0, 'quantity', { allowZero: true })).toBe('0');
  });

  it('rejects numbers in other formats, excess scale and zero when needed', () => {
    for (const value of ['1e3', '1,5', '-1', '.5', '', ' 1']) {
      expect(() =>
        parseDecimal(value, 8, 'price', { allowZero: true }),
      ).toThrow(InvalidInvestmentError);
    }
    expect(() =>
      parseDecimal('1.5', 0, 'quantity', { allowZero: true }),
    ).toThrow(InvalidInvestmentError);
    expect(() =>
      parseDecimal('0.000', 8, 'price', { allowZero: false }),
    ).toThrow(InvalidInvestmentError);
    expect(() =>
      parseDecimal('1'.repeat(19), 0, 'quantity', { allowZero: true }),
    ).toThrow(InvalidInvestmentError);
  });
});
