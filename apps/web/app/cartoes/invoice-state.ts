export type InvoiceDueState =
  'no-purchases' | 'paid' | 'on-time' | 'attention' | 'overdue';

/** Text label for the server-derived state; color is never the only cue. */
export function invoiceStateLabel(
  state: InvoiceDueState,
  daysUntilDue: number,
): string {
  switch (state) {
    case 'overdue':
      return daysUntilDue === -1
        ? 'Vencida há 1 dia'
        : `Vencida há ${String(-daysUntilDue)} dias`;
    case 'attention':
      return daysUntilDue === 0
        ? 'Atenção: vence hoje'
        : daysUntilDue === 1
          ? 'Atenção: vence amanhã'
          : `Atenção: vence em ${String(daysUntilDue)} dias`;
    case 'paid':
      return 'Quitada';
    case 'no-purchases':
      return 'Sem compras';
    case 'on-time':
      return 'Em dia';
  }
}
