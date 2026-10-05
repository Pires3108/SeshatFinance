'use client';

import Link from 'next/link';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import {
  isAccountWithBalance,
  type AccountWithBalance,
  type Lifecycle,
} from '../accounts/account-contract';
import {
  formatBalance,
  lifecycleLabel,
  typeLabel,
} from '../accounts/account-presentation';

const filters: readonly { value: Lifecycle; label: string }[] = [
  { value: 'active', label: 'Ativas' },
  { value: 'archived', label: 'Arquivadas' },
  { value: 'trashed', label: 'Lixeira' },
];

type ViewState =
  'loading' | 'ready' | 'unauthorized' | 'forbidden' | 'unavailable';

export function AccountList(): ReactNode {
  const [filter, setFilter] = useState<Lifecycle>('active');
  const [state, setState] = useState<ViewState>('loading');
  const [items, setItems] = useState<readonly AccountWithBalance[]>([]);
  const [actionError, setActionError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const statusRef = useRef<HTMLParagraphElement>(null);
  const resultRef = useRef<HTMLParagraphElement>(null);
  const actionRef = useRef<HTMLButtonElement | null>(null);
  const requestRef = useRef<AbortController | null>(null);

  const load = useCallback(async (nextFilter: Lifecycle): Promise<void> => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setState('loading');
    setItems([]);
    try {
      const response = await fetch(`/api/accounts?lifecycle=${nextFilter}`, {
        cache: 'no-store',
        signal: controller.signal,
      });
      if (response.status === 401) {
        setState('unauthorized');
        return;
      }
      if (response.status === 403) {
        setState('forbidden');
        return;
      }
      if (!response.ok) {
        setState('unavailable');
        return;
      }
      const data: unknown = await response.json();
      if (controller.signal.aborted) return;
      if (!Array.isArray(data) || !data.every(isAccountWithBalance)) {
        setState('unavailable');
        return;
      }
      setItems(data);
      setState('ready');
    } catch {
      if (controller.signal.aborted) return;
      setState('unavailable');
    }
  }, []);

  useEffect(() => {
    void load(filter);
    return () => requestRef.current?.abort();
  }, [filter, load]);
  useEffect(() => {
    if (
      state === 'unauthorized' ||
      state === 'forbidden' ||
      state === 'unavailable'
    )
      statusRef.current?.focus();
  }, [state]);
  useEffect(() => {
    if (actionError !== '') statusRef.current?.focus();
  }, [actionError]);

  async function change(
    id: string,
    action: string,
    name: string,
  ): Promise<void> {
    const questions: Record<string, string> = {
      archive: `Arquivar ${name}? O histórico e o saldo contábil serão preservados.`,
      unarchive: `Desarquivar ${name}? A conta voltará a ficar ativa.`,
      'move-to-trash': `Mover ${name} para a lixeira? Você poderá restaurar o estado anterior.`,
      'restore-from-trash': `Restaurar ${name} da lixeira? O estado anterior será recuperado.`,
    };
    if (!window.confirm(questions[action] ?? 'Confirmar alteração?')) return;
    actionRef.current =
      document.activeElement instanceof HTMLButtonElement
        ? document.activeElement
        : null;
    setBusyId(id);
    setActionError('');
    let changed = false;
    try {
      const response = await fetch(`/api/accounts/${id}/lifecycle`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      if (response.status === 401) {
        setItems([]);
        setState('unauthorized');
        return;
      }
      if (response.status === 403) {
        setItems([]);
        setState('forbidden');
        return;
      }
      if (!response.ok) {
        setActionError('Não foi possível alterar a conta. Tente novamente.');
        return;
      }
      await load(filter);
      changed = true;
    } catch {
      setActionError('Não foi possível alterar a conta. Tente novamente.');
    } finally {
      setBusyId(null);
      if (changed)
        requestAnimationFrame(() => {
          if (actionRef.current?.isConnected) actionRef.current.focus();
          else (resultRef.current ?? statusRef.current)?.focus();
        });
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
        <Link href="/entrar">Minha sessão</Link>
      </header>
      <main className="accounts-page" id="main-content" tabIndex={-1}>
        <div className="accounts-heading">
          <div>
            <span className="section-label">Seus registros</span>
            <h1>Contas</h1>
            <p>Consulte o saldo contábil e o histórico das suas contas.</p>
          </div>
        </div>
        <nav aria-label="Filtrar contas" className="account-filters">
          {filters.map(({ value, label }) => (
            <button
              aria-pressed={filter === value}
              disabled={busyId !== null}
              className={filter === value ? 'selected' : ''}
              key={value}
              onClick={() => {
                setActionError('');
                setFilter(value);
              }}
              type="button"
            >
              {label}
            </button>
          ))}
        </nav>
        {state === 'loading' && <p role="status">Carregando contas…</p>}
        {state === 'unauthorized' && (
          <p ref={statusRef} role="alert" tabIndex={-1}>
            Seu acesso expirou. <Link href="/entrar">Entre novamente</Link> para
            consultar suas contas.
          </p>
        )}
        {state === 'forbidden' && (
          <p ref={statusRef} role="alert" tabIndex={-1}>
            Você não tem acesso a estas contas.
          </p>
        )}
        {state === 'unavailable' && (
          <p ref={statusRef} role="alert" tabIndex={-1}>
            Não foi possível carregar as contas.{' '}
            <button onClick={() => void load(filter)} type="button">
              Tentar novamente
            </button>
            .
          </p>
        )}
        {actionError !== '' && (
          <p
            className="form-message error"
            ref={statusRef}
            role="alert"
            tabIndex={-1}
          >
            {actionError}
          </p>
        )}
        {state === 'ready' && (
          <>
            <p
              className="account-note"
              ref={resultRef}
              role="status"
              tabIndex={-1}
            >
              {items.length === 0
                ? 'Nenhuma conta nesta seção.'
                : `${String(items.length)} ${items.length === 1 ? 'conta encontrada' : 'contas encontradas'}. Valores em moedas diferentes não são somados.`}
            </p>
            {items.length === 0 ? (
              <p>
                Quando houver contas{' '}
                {filter === 'active'
                  ? 'ativas'
                  : filter === 'archived'
                    ? 'arquivadas'
                    : 'na lixeira'}
                , elas aparecerão aqui.
              </p>
            ) : (
              <ul className="account-list">
                {items.map(({ account, balance }) => (
                  <li className="account-card" key={account.id}>
                    <div>
                      <h2>
                        <Link href={`/contas/${account.id}`}>
                          {account.name}
                        </Link>
                      </h2>
                      <p>
                        {typeLabel(account)} ·{' '}
                        {lifecycleLabel(account.lifecycle)}
                      </p>
                    </div>
                    <p className="account-balance">
                      <span>Saldo contábil</span>
                      <strong>{formatBalance(balance)}</strong>
                    </p>
                    <div className="account-actions">
                      {account.lifecycle === 'active' && (
                        <button
                          disabled={busyId !== null}
                          onClick={() =>
                            void change(account.id, 'archive', account.name)
                          }
                          type="button"
                        >
                          Arquivar
                        </button>
                      )}
                      {account.lifecycle === 'archived' && (
                        <button
                          disabled={busyId !== null}
                          onClick={() =>
                            void change(account.id, 'unarchive', account.name)
                          }
                          type="button"
                        >
                          Desarquivar
                        </button>
                      )}
                      {account.lifecycle !== 'trashed' && (
                        <button
                          disabled={busyId !== null}
                          onClick={() =>
                            void change(
                              account.id,
                              'move-to-trash',
                              account.name,
                            )
                          }
                          type="button"
                        >
                          Mover para a lixeira
                        </button>
                      )}
                      {account.lifecycle === 'trashed' && (
                        <button
                          disabled={busyId !== null}
                          onClick={() =>
                            void change(
                              account.id,
                              'restore-from-trash',
                              account.name,
                            )
                          }
                          type="button"
                        >
                          Restaurar da lixeira
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </main>
    </div>
  );
}
