import type { paths } from '@seshat/contracts';

export type GoalView =
  paths['/api/v1/goals/{goalId}']['get']['responses'][200]['content']['application/json'];
export type GoalLinkView = GoalView['links'][number];
export type GoalStatus = GoalView['progress']['status'];
type MoneyView = Readonly<{ amount: string; currencyCode: string }>;

/** Status labels never rely on color alone (US-053). */
export const statusLabels: Record<GoalStatus, string> = {
  archived: 'Arquivada',
  completed: 'Concluída',
  indeterminate: 'Progresso indisponível (sem cotação)',
  'in-progress': 'Em andamento',
  overdue: 'Atrasada',
  paused: 'Pausada',
};

export function formatMoney(value: MoneyView): string {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/u.exec(value.amount);
  if (match === null) return 'Valor indisponível';
  const [, sign, whole = '0', fraction = ''] = match;
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/gu, '.');
  return `${sign ?? ''}${grouped}${fraction.length > 0 ? `,${fraction}` : ''} ${value.currencyCode}`;
}

export function formatPercent(percent: string): string {
  return `${percent.replace('.', ',')}%`;
}

/** Brazilian decimal ("1.234,56") to API decimal ("1234.56"), or null. */
export function parseDecimalInput(value: string): string | null {
  const compact = value.trim().replace(/\s/gu, '');
  if (!/^\d{1,3}(?:\.?\d{3})*(?:,\d+)?$|^\d+(?:,\d+)?$/u.test(compact)) {
    return null;
  }
  return compact.replace(/\./gu, '').replace(',', '.');
}

export function conversionText(link: GoalLinkView): string {
  const conversion = link.conversion;
  if (conversion.status === 'same-currency') return '';
  if (conversion.status === 'unavailable' || conversion.amount === null) {
    return 'Conversão indisponível: cadastre uma cotação manual.';
  }
  const instant =
    conversion.effectiveAt === null
      ? ''
      : new Date(conversion.effectiveAt).toLocaleString('pt-BR', {
          dateStyle: 'short',
          timeStyle: 'short',
        });
  return `≈ ${formatMoney(conversion.amount)} (taxa ${conversion.rate ?? ''}${conversion.inverted === true ? ', inversa' : ''}, fonte ${conversion.source ?? ''}, ${instant})`;
}

export function isGoal(value: unknown): value is GoalView {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.id === 'string' &&
    typeof item.name === 'string' &&
    typeof item.version === 'number' &&
    Array.isArray(item.links) &&
    typeof item.progress === 'object' &&
    item.progress !== null
  );
}

export function isGoalList(value: unknown): value is GoalView[] {
  return Array.isArray(value) && value.every(isGoal);
}
