'use client';

import { useEffect, useState, type ReactNode } from 'react';

type Presentation = 'separate-income' | 'expense-offset';
type State = 'loading' | 'ready' | 'saving' | 'saved' | 'failed' | 'hidden';

/** Chooses how linked refunds are presented next to the expense. */
export function RefundPresentationForm(): ReactNode {
  const [state, setState] = useState<State>('loading');
  const [current, setCurrent] = useState<Presentation>('separate-income');
  const [selected, setSelected] = useState<Presentation>('separate-income');

  useEffect(() => {
    const controller = new AbortController();
    async function load(): Promise<void> {
      try {
        const response = await fetch('/api/users/me/profile', {
          cache: 'no-store',
          signal: controller.signal,
        });
        if (!response.ok) {
          setState('hidden');
          return;
        }
        const profile = (await response.json()) as {
          refundPresentation?: string;
        };
        const value: Presentation =
          profile.refundPresentation === 'expense-offset'
            ? 'expense-offset'
            : 'separate-income';
        setCurrent(value);
        setSelected(value);
        setState('ready');
      } catch {
        if (!controller.signal.aborted) setState('hidden');
      }
    }
    void load();
    return () => {
      controller.abort();
    };
  }, []);

  async function save(): Promise<void> {
    if (selected === current || state === 'saving') return;
    setState('saving');
    try {
      const response = await fetch('/api/users/me/profile', {
        method: 'PATCH',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refundPresentation: selected }),
      });
      if (!response.ok) {
        setState('failed');
        return;
      }
      setCurrent(selected);
      setState('saved');
    } catch {
      setState('failed');
    }
  }

  if (state === 'loading' || state === 'hidden') return null;
  return (
    <form
      className="form-panel"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <fieldset className="field">
        <legend>Como mostrar reembolsos vinculados</legend>
        <label>
          <input
            type="radio"
            name="refund-presentation"
            checked={selected === 'separate-income'}
            onChange={() => {
              setSelected('separate-income');
              setState('ready');
            }}
          />{' '}
          Despesa pelo valor bruto e reembolso como entrada separada
        </label>
        <label>
          <input
            type="radio"
            name="refund-presentation"
            checked={selected === 'expense-offset'}
            onChange={() => {
              setSelected('expense-offset');
              setState('ready');
            }}
          />{' '}
          Despesa pelo valor líquido, já descontado o reembolso
        </label>
        <p className="field-note">
          A escolha muda só a apresentação. Os saldos e os valores registrados
          continuam os mesmos.
        </p>
      </fieldset>
      <button
        type="submit"
        disabled={selected === current || state === 'saving'}
      >
        {state === 'saving' ? 'Salvando…' : 'Salvar apresentação'}
      </button>
      {state === 'saved' && (
        <p role="status">Apresentação de reembolsos atualizada.</p>
      )}
      {state === 'failed' && (
        <p className="form-message error" role="alert">
          Não foi possível salvar a apresentação. Tente novamente.
        </p>
      )}
    </form>
  );
}
