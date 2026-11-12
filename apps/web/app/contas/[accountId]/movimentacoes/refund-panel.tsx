'use client';

import {
  useCallback,
  useEffect,
  useId,
  useState,
  type ReactNode,
  type SyntheticEvent,
} from 'react';

import {
  formatDecimal,
  isRefundDetails,
  isRefundEntry,
  type RefundDetails,
} from '../../../transactions/refund-contract';
import {
  validAmount,
  type Transaction,
} from '../../../transactions/transaction-contract';

type LoadState = 'loading' | 'ready' | 'unauthorized' | 'error';

const errorMessages: Readonly<Record<number, string>> = {
  400: 'Confira o valor, a data e a descrição do reembolso.',
  401: 'Seu acesso expirou. Entre novamente para registrar o reembolso.',
  404: 'A despesa ou a conta não está mais disponível.',
  409: 'O reembolso excede o valor ainda não reembolsado desta despesa ou conflita com os vínculos atuais.',
};

/** Linked refunds of one expense: summary, entries and a record form. */
export function RefundPanel({ expense }: { expense: Transaction }): ReactNode {
  const fieldId = useId();
  const [details, setDetails] = useState<RefundDetails | null>(null);
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [amount, setAmount] = useState('');
  const [occurredAt, setOccurredAt] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [retryKey, setRetryKey] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setLoadState('loading');
    try {
      const response = await fetch(`/api/transactions/${expense.id}/refunds`, {
        cache: 'no-store',
      });
      if (response.status === 401) {
        setLoadState('unauthorized');
        return;
      }
      const body: unknown = response.ok ? await response.json() : null;
      if (!isRefundDetails(body)) {
        setLoadState('error');
        return;
      }
      setDetails(body);
      setLoadState('ready');
    } catch {
      setLoadState('error');
    }
  }, [expense.id]);

  useEffect(() => {
    void load();
  }, [load]);

  function edit(setter: (value: string) => void, value: string): void {
    setRetryKey(null);
    setMessage('');
    setter(value);
  }

  async function submit(
    event: SyntheticEvent<HTMLFormElement, SubmitEvent>,
  ): Promise<void> {
    event.preventDefault();
    if (!validAmount(amount, expense.currencyMinorUnitScale) || !occurredAt) {
      setMessage(errorMessages[400] ?? '');
      return;
    }
    setBusy(true);
    setMessage('');
    const key = retryKey ?? crypto.randomUUID();
    setRetryKey(key);
    try {
      const response = await fetch(`/api/transactions/${expense.id}/refunds`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': key,
        },
        body: JSON.stringify({
          accountId: expense.accountId,
          amount: amount.replace(',', '.'),
          currencyCode: expense.currencyCode,
          currencyMinorUnitScale: expense.currencyMinorUnitScale,
          description: description.trim() || null,
          occurredAt: new Date(occurredAt).toISOString(),
        }),
      });
      if (!response.ok) {
        setMessage(
          errorMessages[response.status] ??
            'Não foi possível registrar o reembolso. Tente novamente.',
        );
        return;
      }
      const saved: unknown = await response.json();
      if (!isRefundEntry(saved)) {
        setMessage('A resposta da API foi inválida. Recarregue a página.');
        return;
      }
      setAmount('');
      setOccurredAt('');
      setDescription('');
      setRetryKey(null);
      setMessage('Reembolso registrado.');
      await load();
    } catch {
      setMessage(
        'Não foi possível registrar o reembolso. Tente novamente; a repetição não duplica o registro.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="refund-panel" aria-label="Reembolsos">
      <h4>Reembolsos</h4>
      {loadState === 'loading' && <p role="status">Carregando reembolsos…</p>}
      {loadState === 'unauthorized' && <p role="alert">{errorMessages[401]}</p>}
      {loadState === 'error' && (
        <p role="alert">
          Não foi possível carregar os reembolsos.{' '}
          <button type="button" onClick={() => void load()}>
            Tentar novamente
          </button>
        </p>
      )}
      {loadState === 'ready' && details && (
        <>
          <dl>
            <div>
              <dt>Valor bruto</dt>
              <dd>{formatDecimal(details.gross, details.currencyCode)}</dd>
            </div>
            <div>
              <dt>Reembolsado</dt>
              <dd>{formatDecimal(details.refunded, details.currencyCode)}</dd>
            </div>
            <div>
              <dt>Valor líquido</dt>
              <dd>{formatDecimal(details.net, details.currencyCode)}</dd>
            </div>
          </dl>
          {details.entries.length === 0 ? (
            <p>Nenhum reembolso vinculado.</p>
          ) : (
            <ul>
              {details.entries.map((entry) => (
                <li key={entry.id}>
                  {entry.kind === 'refund' ? 'Reembolso' : 'Compensação'} ·{' '}
                  {formatDecimal(entry.amount, entry.currencyCode)} ·{' '}
                  {new Date(entry.occurredAt).toLocaleString('pt-BR')}
                  {entry.description ? ` · ${entry.description}` : ''}
                  {entry.lifecycle === 'active' ? '' : ' (fora dos saldos)'}
                </li>
              ))}
            </ul>
          )}
          {expense.lifecycle === 'active' && (
            <form onSubmit={(event) => void submit(event)}>
              <label htmlFor={`${fieldId}-amount`}>
                Valor do reembolso em {expense.currencyCode}
              </label>
              <input
                id={`${fieldId}-amount`}
                required
                inputMode="decimal"
                value={amount}
                onChange={(event) => {
                  edit(setAmount, event.target.value);
                }}
                disabled={busy}
              />
              <label htmlFor={`${fieldId}-occurred-at`}>
                Data e hora do reembolso
              </label>
              <input
                id={`${fieldId}-occurred-at`}
                required
                type="datetime-local"
                value={occurredAt}
                onChange={(event) => {
                  edit(setOccurredAt, event.target.value);
                }}
                disabled={busy}
              />
              <label htmlFor={`${fieldId}-description`}>
                Descrição do reembolso
              </label>
              <input
                id={`${fieldId}-description`}
                value={description}
                onChange={(event) => {
                  edit(setDescription, event.target.value);
                }}
                disabled={busy}
              />
              <button type="submit" disabled={busy}>
                {busy ? 'Registrando…' : 'Registrar reembolso'}
              </button>
            </form>
          )}
        </>
      )}
      {message && <p role="status">{message}</p>}
    </section>
  );
}
