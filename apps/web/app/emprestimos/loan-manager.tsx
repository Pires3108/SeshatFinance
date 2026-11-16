'use client';

import Link from 'next/link';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type SyntheticEvent,
} from 'react';

import { formatCivilDate } from '../cartoes/card-presentation';
import { LoanDetail } from './loan-detail';
import {
  emptyTerms,
  TermsFields,
  termsPayload,
  type TermsDraft,
} from './loan-terms';
import {
  directionLabel,
  formatLoanAmount,
  isLoan,
  isLoanList,
  statusLabels,
  type LoanView,
} from './loan-presentation';

type LoadState = 'loading' | 'ready' | 'unauthorized' | 'unavailable';
/** Loans to pay or receive, declared by the holder (US-047). */
export function LoanManager(): ReactNode {
  const [state, setState] = useState<LoadState>('loading');
  const [loans, setLoans] = useState<readonly LoanView[]>([]);
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [direction, setDirection] = useState<'receivable' | 'payable'>(
    'receivable',
  );
  const [draft, setDraft] = useState<TermsDraft>(emptyTerms);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<Readonly<{
    kind: 'status' | 'error';
    text: string;
  }> | null>(null);
  const keyRef = useRef('');
  const messageRef = useRef<HTMLParagraphElement>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      const response = await fetch('/api/loans', { cache: 'no-store' });
      if (response.status === 401) {
        setState('unauthorized');
        return;
      }
      const data: unknown = response.ok ? await response.json() : null;
      if (!isLoanList(data)) {
        setState('unavailable');
        return;
      }
      setLoans(data);
      setState('ready');
    } catch {
      setState('unavailable');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (message !== null) messageRef.current?.focus();
  }, [message]);

  function start(): void {
    keyRef.current = crypto.randomUUID();
    setDraft(emptyTerms());
    setDirection('receivable');
    setMessage(null);
    setOpen(true);
  }

  async function submit(
    event: SyntheticEvent<HTMLFormElement, SubmitEvent>,
  ): Promise<void> {
    event.preventDefault();
    if (saving) return;
    const terms = termsPayload(draft);
    if (typeof terms === 'string') {
      setMessage({ kind: 'error', text: terms });
      return;
    }
    setSaving(true);
    try {
      const response = await fetch('/api/loans', {
        body: JSON.stringify({ ...terms, direction }),
        cache: 'no-store',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': keyRef.current,
        },
        method: 'POST',
      });
      const data: unknown = response.ok ? await response.json() : null;
      if (!isLoan(data)) {
        setMessage({
          kind: 'error',
          text: 'Não foi possível registrar o empréstimo. Confira os dados e tente novamente.',
        });
        return;
      }
      setOpen(false);
      setMessage({
        kind: 'status',
        text: `Empréstimo registrado: ${data.description}, ${String(data.count)} parcela(s), total ${formatLoanAmount(data, data.total)}.`,
      });
      setExpanded(data.id);
      await load();
    } catch {
      setMessage({
        kind: 'error',
        text: 'Não foi possível registrar o empréstimo. Tente novamente com os mesmos dados.',
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="site-shell">
      <a className="skip-link" href="#main-content">
        Pular para o conteúdo
      </a>
      <header className="site-header">
        <Link className="brand" href="/">
          Seshat Finance
        </Link>
        <Link href="/contas">Contas</Link>
        <Link href="/cartoes">Cartões</Link>
        <Link href="/preferencias">Preferências</Link>
      </header>
      <main className="accounts-page" id="main-content" tabIndex={-1}>
        <div className="accounts-heading">
          <div>
            <span className="section-label">Seus registros</span>
            <h1>Empréstimos</h1>
            <p>
              Acompanhe valores a pagar ou a receber, com cronograma, juros
              estimados e saldo pendente. O Seshat apenas registra: nada aqui
              transfere dinheiro, cobra ou paga alguém.
            </p>
          </div>
          {!open && state === 'ready' && (
            <button onClick={start} type="button">
              Registrar empréstimo
            </button>
          )}
        </div>
        {message !== null && (
          <p
            className={message.kind === 'error' ? 'form-message error' : ''}
            ref={messageRef}
            role={message.kind === 'error' ? 'alert' : 'status'}
            tabIndex={-1}
          >
            {message.text}
          </p>
        )}
        {open && (
          <form
            aria-label="Registrar empréstimo"
            className="account-form"
            onSubmit={(event) => void submit(event)}
          >
            <fieldset>
              <legend>Tipo</legend>
              <label>
                <input
                  checked={direction === 'receivable'}
                  name="loan-direction"
                  onChange={() => {
                    setDirection('receivable');
                  }}
                  type="radio"
                />{' '}
                Emprestei (a receber)
              </label>{' '}
              <label>
                <input
                  checked={direction === 'payable'}
                  name="loan-direction"
                  onChange={() => {
                    setDirection('payable');
                  }}
                  type="radio"
                />{' '}
                Peguei emprestado (a pagar)
              </label>
            </fieldset>
            <TermsFields draft={draft} prefix="loan" setDraft={setDraft} />
            <div className="account-actions">
              <button disabled={saving} type="submit">
                {saving ? 'Registrando…' : 'Registrar'}
              </button>
              <button
                disabled={saving}
                onClick={() => {
                  setOpen(false);
                }}
                type="button"
              >
                Cancelar
              </button>
            </div>
          </form>
        )}
        {state === 'loading' && <p role="status">Carregando empréstimos…</p>}
        {state === 'unauthorized' && (
          <p role="alert">
            Seu acesso expirou. <Link href="/entrar">Entre novamente</Link> para
            consultar seus empréstimos.
          </p>
        )}
        {state === 'unavailable' && (
          <p role="alert">Empréstimos indisponíveis no momento.</p>
        )}
        {state === 'ready' && loans.length === 0 && !open && (
          <p>Nenhum empréstimo registrado.</p>
        )}
        {state === 'ready' && loans.length > 0 && (
          <ul className="loan-list">
            {loans.map((loan) => (
              <li key={loan.id}>
                <h2>{loan.description}</h2>
                <p>
                  {directionLabel(loan)} · {statusLabels[loan.status]} ·
                  Pendente:{' '}
                  <strong>{formatLoanAmount(loan, loan.pending)}</strong> de{' '}
                  {formatLoanAmount(loan, loan.total)} · {loan.count} parcela(s)
                  desde {formatCivilDate(loan.firstDueOn)}
                </p>
                <button
                  aria-expanded={expanded === loan.id}
                  onClick={() => {
                    setExpanded(expanded === loan.id ? null : loan.id);
                  }}
                  type="button"
                >
                  {expanded === loan.id ? 'Ocultar detalhes' : 'Ver detalhes'}
                </button>
                {expanded === loan.id && (
                  <LoanDetail loan={loan} onChanged={load} />
                )}
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
