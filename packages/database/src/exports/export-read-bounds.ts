import { InvalidExportError, MAX_EXPORT_ROWS } from '@seshat/application';

/**
 * Keep export readers bounded at the database boundary. The extra sentinel row
 * lets the reader reject an oversized result without materializing it all.
 */
export const EXPORT_QUERY_LIMIT = MAX_EXPORT_ROWS + 1;

export function assertBoundedExportRows(
  set: string,
  rows: readonly unknown[],
): void {
  if (rows.length > MAX_EXPORT_ROWS) {
    throw new InvalidExportError(`Export set ${set} exceeds the row limit.`);
  }
}
