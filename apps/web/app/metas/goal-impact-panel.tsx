'use client';

import { useState, type ReactNode, type SyntheticEvent } from 'react';

import {
  formatMoney,
  isGoalList,
  statusLabels,
  type GoalView,
} from './goal-presentation';

type Choice = 'keep' | 'unlink' | 'archive';
export type AccountChange = 'archive' | 'move-to-trash';

/** Goals that use the account; empty when there are none or on failure. */
export async function loadAccountGoalImpact(
  accountId: string,
): Promise<readonly GoalView[] | null> {
  try {
    const response = await fetch(
      `/api/goals/account-impact/${encodeURIComponent(accountId)}`,
      { cache: 'no-store' },
    );
    if (!response.ok) return null;
    const data: unknown = await response.json();
    return isGoalList(data) ? data : null;
  } catch {
    return null;
  }
}

const effects: Record<AccountChange, string> = {
  archive:
    'Uma conta arquivada continua contando para a meta com o saldo que tiver.',
  'move-to-trash':
    'Uma conta na lixeira deixa de contar para a meta (vale zero) até ser restaurada.',
};

/**
 * Impact panel (US-049): before archiving or trashing an account used by
 * goals, the holder chooses explicitly what happens to each goal.
 */
export function GoalImpactPanel({
  accountId,
  accountName,
  change,
  goals,
  onCancel,
  onConfirmed,
}: Readonly<{
  accountId: string;
  accountName: string;
  change: AccountChange;
  goals: readonly GoalView[];
  onCancel: () => void;
  onConfirmed: () => Promise<void>;
}>): ReactNode {
  const [choices, setChoices] = useState<Readonly<Record<string, Choice>>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pending = goals.filter((goal) => choices[goal.id] === undefined);

  async function confirm(
    event: SyntheticEvent<HTMLFormElement, SubmitEvent>,
  ): Promise<void> {
    event.preventDefault();
    if (busy) return;
    if (pending.length > 0) {
      setError('Escolha o que fazer com cada meta antes de confirmar.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      for (const goal of goals) {
        const choice = choices[goal.id];
        if (choice === 'keep') continue;
        const response = await fetch(
          choice === 'unlink'
            ? `/api/goals/${goal.id}/unlink-account`
            : `/api/goals/${goal.id}/lifecycle`,
          {
            body: JSON.stringify(
              choice === 'unlink'
                ? { accountId, expectedVersion: goal.version }
                : { action: 'archive', expectedVersion: goal.version },
            ),
            cache: 'no-store',
            headers: { 'Content-Type': 'application/json' },
            method: 'POST',
          },
        );
        if (!response.ok) {
          setError(
            `Não foi possível aplicar a escolha para a meta ${goal.name}. Nada foi alterado na conta.`,
          );
          return;
        }
      }
      await onConfirmed();
    } catch {
      setError('Não foi possível aplicar as escolhas. Tente novamente.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      aria-label={`Impacto nas metas de ${accountName}`}
      className="account-form"
      onSubmit={(event) => void confirm(event)}
    >
      <h2>Esta conta participa de metas</h2>
      <p>{effects[change]} Escolha o que fazer com cada meta.</p>
      {goals.map((goal) => {
        const link = goal.links.find((item) => item.accountId === accountId);
        return (
          <fieldset key={goal.id}>
            <legend>
              {goal.name} · {statusLabels[goal.progress.status]}
              {link !== undefined &&
                ` · conta hoje ${formatMoney(link.counted)}`}
            </legend>
            {(
              [
                ['keep', 'Manter a conta na meta'],
                ['unlink', 'Tirar a conta da meta'],
                ['archive', 'Arquivar a meta'],
              ] as const
            ).map(([value, label]) => (
              <label key={value}>
                <input
                  checked={choices[goal.id] === value}
                  name={`impact-${goal.id}`}
                  onChange={() => {
                    setChoices({ ...choices, [goal.id]: value });
                  }}
                  type="radio"
                />{' '}
                {label}
              </label>
            ))}
          </fieldset>
        );
      })}
      {error !== '' && (
        <p className="form-message error" role="alert">
          {error}
        </p>
      )}
      <div className="account-actions">
        <button disabled={busy} type="submit">
          {change === 'archive' ? 'Confirmar e arquivar' : 'Confirmar e mover'}
        </button>
        <button disabled={busy} onClick={onCancel} type="button">
          Cancelar
        </button>
      </div>
    </form>
  );
}
