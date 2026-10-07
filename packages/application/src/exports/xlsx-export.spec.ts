import { inflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { serializeExportXlsx } from './xlsx-export.js';
import type { BuildExportUseCase } from './export-contract.js';

type Document = Awaited<ReturnType<BuildExportUseCase['execute']>>;
const document: Document = {
  version: '1',
  generated_at: '2026-10-07T12:00:00.000Z',
  zone: 'America/Sao_Paulo',
  filters: {
    from: null,
    to: null,
    accountIds: [],
    categoryIds: [],
    entityIds: [],
    includeArchived: false,
    includeTrash: false,
    sets: ['accounts', 'transactions'],
  },
  reference_inclusions: {},
  data: {
    accounts: [
      {
        id: 'a',
        name: 'A',
        type: 'checking',
        institution: null,
        initial_balance: { amount: '12345678901234567890.12', currency: 'BRL' },
        lifecycle: 'active',
        created_at: '2026-01-01T00:00:00.000Z',
      },
    ],
    transactions: [
      {
        id: 't',
        account_id: 'a',
        category_id: null,
        subcategory_id: null,
        cost_center_id: null,
        tag_ids: [],
        kind: 'expense',
        amount: { amount: '-10.50', currency: 'BRL' },
        description: '=2+2',
        occurred_at: '2026-01-02T00:00:00.000Z',
        lifecycle: 'active',
        created_at: '2026-01-02T00:00:00.000Z',
      },
    ],
  },
};

function xmlParts(bytes: Uint8Array): string[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const parts: string[] = [];
  for (let offset = 0; offset + 30 < bytes.length;) {
    if (view.getUint32(offset, true) !== 0x04034b50) {
      offset += 1;
      continue;
    }
    const method = view.getUint16(offset + 8, true);
    const size = view.getUint32(offset + 18, true);
    const nameSize = view.getUint16(offset + 26, true);
    const extraSize = view.getUint16(offset + 28, true);
    const start = offset + 30 + nameSize + extraSize;
    if (method === 8)
      parts.push(
        new TextDecoder().decode(
          inflateRawSync(bytes.slice(start, start + size)),
        ),
      );
    offset = start + size;
  }
  return parts;
}

describe('XLSX export', () => {
  it('writes valid workbook parts and inert cells in entity layout', () => {
    const parts = xmlParts(serializeExportXlsx(document));
    expect(parts.join('\n')).toContain('Summary');
    expect(parts.join('\n')).toContain('transactions');
    expect(parts.join('\n')).toContain('12345678901234567890.12');
    expect(parts.join('\n')).not.toContain('<f>');
    expect(parts.join('\n')).toContain('=2+2');
    expect(parts.join('\n')).toContain(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml',
    );
  });
  it('supports a single table and empty selected sets', () => {
    const empty = { ...document, data: { accounts: [] } } as Document;
    const parts = xmlParts(serializeExportXlsx(empty, { layout: 'single' }));
    expect(parts.join('\n')).toContain('Data');
    expect(parts.join('\n')).toContain('<row r="1">');
  });
});
