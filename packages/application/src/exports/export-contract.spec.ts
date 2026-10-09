import { describe, expect, it } from 'vitest';
import {
  BuildExportUseCase,
  InvalidExportError,
  canonicalizeExportRows,
  parseExportSelection,
  serializeExportCsv,
  serializeExportCsvBundle,
  serializeExportJson,
  type ExportFilters,
  type ExportRow,
} from './export-contract.js';

const actor = '11111111-1111-4111-8111-111111111111';
const foreign = '22222222-2222-4222-8222-222222222222';
const tx = '33333333-3333-4333-8333-333333333333';
const account = '44444444-4444-4444-8444-444444444444';
const selection = { sets: ['transactions'], zone: 'America/Sao_Paulo' };
const filters: ExportFilters = parseExportSelection(selection).filters;

function transaction(
  ownerId = actor,
  description: string | null = null,
): ExportRow {
  return {
    id: tx,
    ownerId,
    account_id: account,
    category_id: null,
    subcategory_id: null,
    cost_center_id: null,
    tag_ids: [],
    kind: 'expense',
    amount: { amount: '10.25', currency: 'BRL' },
    description,
    occurred_at: '2026-10-06T13:20:00.000Z',
    lifecycle: 'active',
    created_at: '2026-10-06T13:21:00.000Z',
    secret: 'must never export',
    account_number: '1234567890',
    attachment_url: 'private://file',
  };
}

describe('export contract v1', () => {
  it('preserves exact money, relationships, explicit null and excludes unlisted fields', async () => {
    const useCase = new BuildExportUseCase(
      {
        assertAuthorizedSelection: (): Promise<void> => Promise.resolve(),
        readAuthorized: (set): Promise<readonly ExportRow[]> =>
          Promise.resolve(
            set === 'transactions'
              ? [transaction()]
              : [
                  {
                    id: account,
                    ownerId: actor,
                    name: 'Synthetic',
                    type: 'checking-account',
                    institution: null,
                    initial_balance: { amount: '0.00', currency: 'BRL' },
                    lifecycle: 'active',
                    created_at: '2026-10-01T00:00:00.000Z',
                  },
                ],
          ),
      },
      { now: (): Date => new Date('2026-10-07T00:00:00.000Z') },
    );
    const json = serializeExportJson(await useCase.execute(actor, selection));
    const value = JSON.parse(json) as {
      version: string;
      zone: string;
      data: { transactions: Record<string, unknown>[] };
    };
    expect(value.version).toBe('1');
    expect(value.zone).toBe('America/Sao_Paulo');
    expect(value.data.transactions[0]).toEqual({
      id: tx,
      account_id: account,
      category_id: null,
      subcategory_id: null,
      cost_center_id: null,
      tag_ids: [],
      kind: 'expense',
      amount: { amount: '10.25', currency: 'BRL' },
      description: null,
      occurred_at: '2026-10-06T13:20:00.000Z',
      lifecycle: 'active',
      created_at: '2026-10-06T13:21:00.000Z',
    });
    expect(json).not.toMatch(
      /secret|account_number|attachment_url|private:\/\//u,
    );
  });

  it('keeps very large decimals as text and rejects a foreign owner', () => {
    const huge = {
      ...transaction(),
      amount: {
        amount: '1000000000000000000000000000000000000000.01',
        currency: 'BRL',
      },
    };
    expect(
      canonicalizeExportRows('transactions', [huge], actor, filters)[0]?.amount,
    ).toEqual(huge.amount);
    expect(() =>
      canonicalizeExportRows(
        'transactions',
        [transaction(foreign)],
        actor,
        filters,
      ),
    ).toThrow(InvalidExportError);
  });

  it('writes a valid empty CSV header and escapes formulas only in CSV text', () => {
    const row = canonicalizeExportRows(
      'transactions',
      [transaction(actor, '=SUM(1,1)\r\n"x"')],
      actor,
      filters,
    )[0];
    if (row === undefined) throw new Error('Expected export row.');
    const empty = serializeExportCsv('transactions', []);
    expect(empty).toBe(
      'id,account_id,category_id,subcategory_id,cost_center_id,tag_ids,kind,amount_amount,amount_currency,description,occurred_at,lifecycle,created_at\r\n',
    );
    const csv = serializeExportCsv('transactions', [row]);
    expect(csv).toContain('"\'=SUM(1,1)\r\n""x"""');
    expect(row.description).toBe('=SUM(1,1)\r\n"x"');
    for (const prefix of ['+', '-', '@', '\t', '\r']) {
      const attack = canonicalizeExportRows(
        'transactions',
        [transaction(actor, `${prefix}cmd`)],
        actor,
        filters,
      )[0];
      if (attack === undefined) throw new Error('Expected export row.');
      expect(serializeExportCsv('transactions', [attack])).toContain(
        `'${prefix}cmd`,
      );
    }
  });

  it('validates filters and IANA zone', () => {
    expect(() =>
      parseExportSelection({ ...selection, from: '2026-02-30' }),
    ).toThrow(InvalidExportError);
    expect(() =>
      parseExportSelection({ ...selection, accountIds: [foreign, 'bad'] }),
    ).toThrow(InvalidExportError);
    expect(() =>
      parseExportSelection({ ...selection, zone: 'Nowhere/Unknown' }),
    ).toThrow(InvalidExportError);
    expect(() =>
      parseExportSelection({ ...selection, includeTrash: 'yes' }),
    ).toThrow(InvalidExportError);
    expect(() =>
      parseExportSelection({ ...selection, entityIds: [foreign] }),
    ).toThrow(InvalidExportError);
  });

  it('passes the civil period and zone to the authorized reader', async () => {
    const observed: string[] = [];
    const useCase = new BuildExportUseCase(
      {
        assertAuthorizedSelection: (_actorId, filters, zone): Promise<void> => {
          observed.push(`${filters.from ?? ''}/${filters.to ?? ''}/${zone}`);
          return Promise.resolve();
        },
        readAuthorized: (
          _set,
          _actorId,
          filters,
          zone,
        ): Promise<readonly ExportRow[]> => {
          observed.push(`${filters.from ?? ''}/${filters.to ?? ''}/${zone}`);
          return Promise.resolve([]);
        },
      },
      { now: (): Date => new Date('2026-10-07T00:00:00.000Z') },
    );
    await useCase.execute(actor, {
      ...selection,
      from: '2026-10-01',
      to: '2026-10-31',
    });
    expect(observed).toEqual([
      '2026-10-01/2026-10-31/America/Sao_Paulo',
      '2026-10-01/2026-10-31/America/Sao_Paulo',
    ]);
  });

  it('keeps schema and metadata for an empty CSV selection', async () => {
    const useCase = new BuildExportUseCase(
      {
        assertAuthorizedSelection: (): Promise<void> => Promise.resolve(),
        readAuthorized: (): Promise<readonly ExportRow[]> =>
          Promise.resolve([]),
      },
      { now: (): Date => new Date('2026-10-07T00:00:00.000Z') },
    );
    const bundle = serializeExportCsvBundle(
      await useCase.execute(actor, selection),
    );
    expect(bundle.tables.transactions).toContain(
      'amount_amount,amount_currency',
    );
    expect(bundle.tables.transactions?.split('\r\n')).toHaveLength(2);
    expect(JSON.parse(bundle.manifest)).toMatchObject({
      version: '1',
      zone: 'America/Sao_Paulo',
      sets: ['transactions'],
    });
  });

  it('closes authorized transfer and account references outside selected filters', async () => {
    const otherTx = '77777777-7777-4777-8777-777777777777';
    const otherAccount = '88888888-8888-4888-8888-888888888888';
    const transfer: ExportRow = {
      id: '99999999-9999-4999-8999-999999999999',
      ownerId: actor,
      source_transaction_id: tx,
      destination_transaction_id: otherTx,
      created_at: '2026-10-06T13:22:00.000Z',
    };
    const accountRow = (id: string): ExportRow => ({
      id,
      ownerId: actor,
      name: 'Synthetic',
      type: 'checking-account',
      institution: null,
      initial_balance: { amount: '0.00', currency: 'BRL' },
      lifecycle: 'archived',
      created_at: '2026-10-01T00:00:00.000Z',
    });
    const useCase = new BuildExportUseCase(
      {
        assertAuthorizedSelection: (): Promise<void> => Promise.resolve(),
        readAuthorized: (set): Promise<readonly ExportRow[]> =>
          Promise.resolve(
            set === 'transfers'
              ? [transfer]
              : set === 'transactions'
                ? [
                    transaction(),
                    { ...transaction(), id: otherTx, account_id: otherAccount },
                  ]
                : set === 'accounts'
                  ? [accountRow(account), accountRow(otherAccount)]
                  : [],
          ),
      },
      { now: (): Date => new Date('2026-10-07T00:00:00.000Z') },
    );
    const result = await useCase.execute(actor, {
      sets: ['transfers'],
      zone: 'America/Sao_Paulo',
    });
    expect(result.data.transactions).toHaveLength(2);
    expect(result.data.accounts).toHaveLength(2);
    expect(result.reference_inclusions.transactions).toEqual(
      [tx, otherTx].sort(),
    );
    expect(result.reference_inclusions.accounts).toEqual(
      [account, otherAccount].sort(),
    );
  });

  it('requires explicit trash opt-in for an account referenced by an active transaction', async () => {
    const trashedAccount: ExportRow = {
      id: account,
      ownerId: actor,
      name: 'Synthetic account',
      type: 'checking-account',
      institution: null,
      initial_balance: { amount: '0.00', currency: 'BRL' },
      lifecycle: 'trashed',
      created_at: '2026-10-01T00:00:00.000Z',
    };
    const useCase = new BuildExportUseCase(
      {
        assertAuthorizedSelection: (): Promise<void> => Promise.resolve(),
        readAuthorized: (
          set,
          _actorId,
          filters,
        ): Promise<readonly ExportRow[]> =>
          Promise.resolve(
            set === 'transactions'
              ? [transaction()]
              : set === 'accounts' && filters.includeTrash
                ? [trashedAccount]
                : [],
          ),
      },
      { now: (): Date => new Date('2026-10-07T00:00:00.000Z') },
    );
    await expect(useCase.execute(actor, selection)).rejects.toThrow(
      'retry with includeTrash',
    );
    const result = await useCase.execute(actor, {
      ...selection,
      includeTrash: true,
    });
    expect(result.data.transactions).toHaveLength(1);
    expect(result.data.accounts?.[0]?.lifecycle).toBe('trashed');
    expect(result.reference_inclusions.accounts).toEqual([account]);
  });
});
