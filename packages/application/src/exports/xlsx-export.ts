import { deflateRawSync } from 'node:zlib';
import {
  EXPORT_SCHEMA,
  EXPORT_SETS,
  InvalidExportError,
  type ExportMoney,
  type ExportScalar,
  type ExportSet,
  type BuildExportUseCase,
} from './export-contract.js';

export type XlsxLayout = 'entities' | 'single';
export type XlsxExportOptions = Readonly<{ layout?: XlsxLayout }>;
export const MAX_XLSX_BYTES = 50 * 1024 * 1024;
export const MAX_XLSX_SHEETS = 65;
export const MAX_XLSX_ROWS_PER_SHEET = 1_048_576;

type ExportDocument = Awaited<ReturnType<BuildExportUseCase['execute']>>;
type Cell = Readonly<{ value: string; type?: 'number' }>;

export function serializeExportXlsx(
  document: ExportDocument,
  options: XlsxExportOptions = {},
): Uint8Array {
  const layout = options.layout ?? 'entities';
  const sets = EXPORT_SETS.filter((set) => document.data[set] !== undefined);
  const totalRows = sets.reduce(
    (total, set) => total + (document.data[set]?.length ?? 0),
    0,
  );
  if (totalRows > 100_000)
    throw new InvalidExportError('XLSX row limit exceeded.');
  const sheets =
    layout === 'entities'
      ? [
          { name: 'Summary', rows: summaryRows(document, sets) },
          ...sets.map((set) => ({
            name: sheetName(set),
            rows: entityRows(set, document.data[set] ?? []),
          })),
        ]
      : [
          { name: 'Summary', rows: summaryRows(document, sets) },
          { name: 'Data', rows: singleRows(sets, document) },
        ];
  if (sheets.length > MAX_XLSX_SHEETS)
    throw new InvalidExportError('XLSX sheet limit exceeded.');
  for (const sheet of sheets)
    if (sheet.rows.length > MAX_XLSX_ROWS_PER_SHEET)
      throw new InvalidExportError('XLSX row limit exceeded.');
  const files = workbookFiles(sheets);
  const archive = zip(files);
  if (archive.byteLength > MAX_XLSX_BYTES)
    throw new InvalidExportError('XLSX memory limit exceeded.');
  return archive;
}

function summaryRows(
  document: ExportDocument,
  sets: readonly ExportSet[],
): readonly Cell[][] {
  const filters = JSON.stringify(document.filters);
  const references = JSON.stringify(document.reference_inclusions);
  const rows: readonly string[][] = [
    ['Campo', 'Valor'],
    ['Versão', document.version],
    ['Gerado em UTC', document.generated_at],
    ['Fuso horário IANA', document.zone],
    ['Filtros normalizados', filters],
    ['Conjuntos', sets.join(', ')],
    ['Inclusões de referência', references],
  ];
  return rows.map((row) => row.map((value) => ({ value })));
}

function entityRows(
  set: ExportSet,
  rows: readonly Record<string, ExportScalar>[],
): readonly Cell[][] {
  const fields = EXPORT_SCHEMA[set];
  const header = fields.flatMap((field) =>
    fieldColumns(field.name, field.kind),
  );
  return [
    header.map((value) => ({ value })),
    ...rows.map((row) =>
      fields.flatMap((field) => fieldCells(row[field.name], field.kind)),
    ),
  ];
}

function singleRows(
  sets: readonly ExportSet[],
  document: ExportDocument,
): readonly Cell[][] {
  const fields = [
    ...new Set(
      sets.flatMap((set) =>
        EXPORT_SCHEMA[set].flatMap((field) =>
          fieldColumns(field.name, field.kind),
        ),
      ),
    ),
  ];
  const header = ['entity', ...fields];
  const output: Cell[][] = [header.map((value) => ({ value }))];
  for (const set of sets) {
    const schema = EXPORT_SCHEMA[set];
    for (const row of document.data[set] ?? []) {
      const values = new Map<string, Cell>();
      for (const field of schema) {
        const columns = fieldColumns(field.name, field.kind);
        fieldCells(row[field.name], field.kind).forEach((cell, index) =>
          values.set(columns[index] ?? columns[0] ?? '', cell),
        );
      }
      output.push([
        { value: set },
        ...fields.map((field) => values.get(field) ?? { value: '' }),
      ]);
    }
  }
  return output;
}

function fieldColumns(name: string, kind: string): readonly string[] {
  if (kind === 'money')
    return [`${name}_amount`, `${name}_currency`, `${name}_pt_br`];
  if (kind === 'instant' || kind === 'date')
    return [`${name}_utc`, `${name}_pt_br`];
  return [name];
}

function fieldCells(
  value: ExportScalar | undefined,
  kind: string,
): readonly Cell[] {
  if (kind === 'money') {
    const money = value as ExportMoney | null | undefined;
    if (money === null || money === undefined)
      return [{ value: '' }, { value: '' }, { value: '' }];
    return [
      { value: money.amount },
      { value: money.currency },
      { value: formatMoney(money.amount, money.currency) },
    ];
  }
  if (kind === 'instant' || kind === 'date') {
    if (typeof value !== 'string') return [{ value: '' }, { value: '' }];
    return [{ value }, { value: formatDate(value) }];
  }
  return [{ value: scalarText(value) }];
}

function scalarText(value: ExportScalar | undefined): string {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'object') return '';
  return String(value);
}

function formatDate(value: string): string {
  const date = new Date(value.includes('T') ? value : `${value}T00:00:00.000Z`);
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeZone: 'UTC',
  }).format(date);
}

function formatMoney(amount: string, currency: string): string {
  const negative = amount.startsWith('-');
  const unsigned = negative ? amount.slice(1) : amount;
  const [integer = '', fraction = ''] = unsigned.split('.');
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/gu, '.');
  return `${negative ? '-' : ''}${grouped},${fraction.padEnd(2, '0')} ${currency}`;
}

function sheetName(set: string): string {
  return set.slice(0, 31).replace(/[\\/?*:[\]]/gu, '_');
}

type Sheet = Readonly<{ name: string; rows: readonly Cell[][] }>;
function workbookFiles(
  sheets: readonly Sheet[],
): ReadonlyMap<string, Uint8Array> {
  const escapedNames = sheets.map((sheet) => xml(sheet.name));
  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${escapedNames.map((name, index) => `<sheet name="${name}" sheetId="${String(index + 1)}" r:id="rId${String(index + 1)}"/>`).join('')}</sheets></workbook>`;
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, index) => `<Relationship Id="rId${String(index + 1)}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${String(index + 1)}.xml"/>`).join('')}</Relationships>`;
  const files = new Map<string, Uint8Array>([
    [
      '[Content_Types].xml',
      bytes(
        `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets.map((_, index) => `<Override PartName="/xl/worksheets/sheet${String(index + 1)}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`,
      ),
    ],
    [
      '_rels/.rels',
      bytes(
        `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
      ),
    ],
    ['xl/workbook.xml', bytes(workbook)],
    ['xl/_rels/workbook.xml.rels', bytes(rels)],
  ]);
  sheets.forEach((sheet, index) =>
    files.set(
      `xl/worksheets/sheet${String(index + 1)}.xml`,
      bytes(sheetXml(sheet.rows)),
    ),
  );
  return files;
}

function sheetXml(rows: readonly Cell[][]): string {
  return `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows.map((row, r) => `<row r="${String(r + 1)}">${row.map((cell, c) => `<c r="${column(c)}${String(r + 1)}" t="${cell.type === 'number' ? 'n' : 'inlineStr'}">${cell.type === 'number' ? `<v>${xml(cell.value)}</v>` : `<is><t>${xml(cell.value)}</t></is>`}</c>`).join('')}</row>`).join('')}</sheetData></worksheet>`;
}
function column(index: number): string {
  let result = '';
  for (let value = index + 1; value > 0; value = Math.floor((value - 1) / 26))
    result = String.fromCharCode(65 + ((value - 1) % 26)) + result;
  return result;
}
function xml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}
function bytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function zip(files: ReadonlyMap<string, Uint8Array>): Uint8Array {
  const local: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const [name, data] of files) {
    const nameBytes = bytes(name);
    const compressed = deflateRawSync(data);
    const crc = crc32(data);
    const header = concat(
      u32(0x04034b50),
      u16(20),
      u16(0),
      u16(8),
      u16(0),
      u16(0),
      u32(crc),
      u32(compressed.length),
      u32(data.length),
      u16(nameBytes.length),
      u16(0),
      nameBytes,
      compressed,
    );
    local.push(header);
    central.push(
      concat(
        u32(0x02014b50),
        u16(20),
        u16(20),
        u16(0),
        u16(8),
        u16(0),
        u16(0),
        u32(crc),
        u32(compressed.length),
        u32(data.length),
        u16(nameBytes.length),
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        u32(0),
        u32(offset),
        nameBytes,
      ),
    );
    offset += header.length;
  }
  const centralBytes = concat(...central);
  return concat(
    ...local,
    centralBytes,
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(files.size),
    u16(files.size),
    u32(centralBytes.length),
    u32(offset),
    u16(0),
  );
}
function u16(value: number): Uint8Array {
  const output = new Uint8Array(2);
  new DataView(output.buffer).setUint16(0, value, true);
  return output;
}
function u32(value: number): Uint8Array {
  const output = new Uint8Array(4);
  new DataView(output.buffer).setUint32(0, value >>> 0, true);
  return output;
}
function concat(...parts: Uint8Array[]): Uint8Array {
  const output = new Uint8Array(
    parts.reduce((sum, part) => sum + part.length, 0),
  );
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}
function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++)
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
