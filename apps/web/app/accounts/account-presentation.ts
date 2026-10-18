import type { Account, AccountBalance, Lifecycle } from './account-contract';

const typeLabels: Record<string, string> = {
  'checking-account': 'Conta corrente',
  'savings-account': 'Poupança',
  'cash-wallet': 'Carteira',
  reserve: 'Reserva',
  'credit-card': 'Cartão de crédito',
  'investment-account': 'Conta de investimento',
};

const lifecycleLabels: Record<Lifecycle, string> = {
  active: 'Ativa',
  archived: 'Arquivada',
  trashed: 'Na lixeira',
};

export function typeLabel(account: Account): string {
  return typeLabels[account.typeKey] ?? 'Outro tipo de conta';
}

export function lifecycleLabel(lifecycle: Lifecycle): string {
  return lifecycleLabels[lifecycle];
}

export function formatBalance(balance: AccountBalance): string {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/u.exec(balance.amount);
  if (match === null) return 'Saldo indisponível';
  const [, sign, whole = '0', fraction = ''] = match;
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/gu, '.');
  const decimals = fraction.padEnd(balance.currencyMinorUnitScale, '0');
  return `${sign ?? ''}${grouped}${decimals.length > 0 ? `,${decimals}` : ''} ${balance.currencyCode}`;
}
