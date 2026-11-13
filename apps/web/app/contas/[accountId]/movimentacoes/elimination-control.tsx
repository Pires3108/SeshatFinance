'use client';

import { useId, useState, type ReactNode } from 'react';

import type { Transaction } from '../../../transactions/transaction-contract';

const failures: Readonly<Record<number, string>> = {
  400: 'O identificador digitado não confere.',
  401: 'Seu acesso expirou. Entre novamente para eliminar.',
  404: 'A movimentação não está mais disponível.',
  409: 'Não é possível eliminar: a movimentação faz parte de uma transferência, tem reembolso ou ajuste vinculado, ou mudou. Recarregue e tente novamente.',
};

/**
 * Permanent elimination from the trash with reinforced confirmation (RF-090):
 * the person types the item identifier before the action is enabled.
 */
export function EliminationControl({
  item,
  onEliminated,
}: {
  item: Transaction;
  onEliminated: () => Promise<void>;
}): ReactNode {
  const fieldId = useId();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const matches = typed.trim().toLowerCase() === item.id.toLowerCase();

  async function eliminate(): Promise<void> {
    if (!matches || busy) return;
    setBusy(true);
    setError('');
    try {
      const response = await fetch(`/api/transactions/${item.id}/elimination`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmation: typed.trim() }),
      });
      if (!response.ok) {
        setError(
          failures[response.status] ??
            'Não foi possível eliminar. Tente novamente.',
        );
        return;
      }
      setOpen(false);
      setTyped('');
      await onEliminated();
    } catch {
      setError('Não foi possível eliminar. Tente novamente.');
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          setOpen(true);
        }}
      >
        Eliminar definitivamente
      </button>
    );
  }
  return (
    <div className="elimination-confirmation" role="group">
      <p>
        A eliminação é definitiva: a movimentação sai da lixeira e não poderá
        ser restaurada. O registro de auditoria é mantido.
      </p>
      <label htmlFor={`${fieldId}-confirmation`}>
        Digite o identificador {item.id} para confirmar
      </label>
      <input
        id={`${fieldId}-confirmation`}
        autoComplete="off"
        value={typed}
        onChange={(event) => {
          setTyped(event.target.value);
          setError('');
        }}
        disabled={busy}
      />
      <button
        type="button"
        disabled={!matches || busy}
        onClick={() => void eliminate()}
      >
        {busy ? 'Eliminando…' : 'Confirmar eliminação'}
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          setOpen(false);
          setTyped('');
          setError('');
        }}
      >
        Cancelar
      </button>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
