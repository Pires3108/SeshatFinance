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
} from '../../accounts/account-contract';
import {
  formatBalance,
  lifecycleLabel,
  typeLabel,
} from '../../accounts/account-presentation';

type ViewState =
  | 'loading'
  | 'ready'
  | 'unauthorized'
  | 'forbidden'
  | 'not-found'
  | 'unavailable';

export function AccountDetail({ accountId }: { accountId: string }): ReactNode {
  const [state, setState] = useState<ViewState>('loading');
  const [item, setItem] = useState<AccountWithBalance | null>(null);
  const [actionError, setActionError] = useState('');
  const [busy, setBusy] = useState(false);
  const statusRef = useRef<HTMLParagraphElement>(null);
  const resultRef = useRef<HTMLHeadingElement>(null);
  const actionRef = useRef<HTMLButtonElement | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setState('loading');
    setItem(null);
    try {
      const response = await fetch(
        `/api/accounts/${encodeURIComponent(accountId)}`,
        { cache: 'no-store' },
      );
      if (response.status === 401) {
        setState('unauthorized');
        return;
      }
      if (response.status === 403) {
        setState('forbidden');
        return;
      }
      if (response.status === 404) {
        setState('not-found');
        return;
      }
      if (!response.ok) {
        setState('unavailable');
        return;
      }
      const data: unknown = await response.json();
      if (!isAccountWithBalance(data) || data.account.id !== accountId) {
        setState('unavailable');
        return;
      }
      setItem(data);
      setState('ready');
    } catch {
      setState('unavailable');
    }
  }, [accountId]);

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (state !== 'ready' && state !== 'loading') statusRef.current?.focus();
  }, [state]);
  useEffect(() => {
    if (actionError !== '') statusRef.current?.focus();
  }, [actionError]);

  async function change(action: string): Promise<void> {
    if (item === null) return;
    const questions: Record<string, string> = {
      archive: `Arquivar ${item.account.name}? O histórico e o saldo contábil serão preservados.`,
      unarchive: `Desarquivar ${item.account.name}? A conta voltará a ficar ativa.`,
      'move-to-trash': `Mover ${item.account.name} para a lixeira? Você poderá restaurar o estado anterior.`,
      'restore-from-trash': `Restaurar ${item.account.name} da lixeira? O estado anterior será recuperado.`,
    };
    if (!window.confirm(questions[action] ?? 'Confirmar alteração?')) return;
    actionRef.current =
      document.activeElement instanceof HTMLButtonElement
        ? document.activeElement
        : null;
    setBusy(true);
    setActionError('');
    let changed = false;
    try {
      const response = await fetch(`/api/accounts/${accountId}/lifecycle`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      if (response.status === 401) {
        setItem(null);
        setState('unauthorized');
        return;
      }
      if (response.status === 403) {
        setItem(null);
        setState('forbidden');
        return;
      }
      if (response.status === 404) {
        setItem(null);
        setState('not-found');
        return;
      }
      if (!response.ok) {
        setActionError('Não foi possível alterar a conta. Tente novamente.');
        return;
      }
      await load();
      changed = true;
    } catch {
      setActionError('Não foi possível alterar a conta. Tente novamente.');
    } finally {
      setBusy(false);
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
        <Link href="/contas">Todas as contas</Link>
      </header>
      <main className="accounts-page" id="main-content" tabIndex={-1}>
        <Link href="/contas">← Voltar às contas</Link>
        {state === 'loading' && <p role="status">Carregando conta…</p>}
        {state === 'unauthorized' && (
          <p ref={statusRef} role="alert" tabIndex={-1}>
            Seu acesso expirou. <Link href="/entrar">Entre novamente</Link> para
            consultar esta conta.
          </p>
        )}
        {state === 'forbidden' && (
          <p ref={statusRef} role="alert" tabIndex={-1}>
            Você não tem acesso a esta conta.{' '}
            <Link href="/contas">Voltar às contas</Link>.
          </p>
        )}
        {state === 'not-found' && (
          <p ref={statusRef} role="alert" tabIndex={-1}>
            Conta não encontrada ou indisponível para você.{' '}
            <Link href="/contas">Voltar às contas</Link>.
          </p>
        )}
        {state === 'unavailable' && (
          <p ref={statusRef} role="alert" tabIndex={-1}>
            Não foi possível carregar a conta.{' '}
            <button onClick={() => void load()} type="button">
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
        {state === 'ready' && item !== null && (
          <article className="account-detail">
            <span className="section-label">Detalhe da conta</span>
            <h1 ref={resultRef} tabIndex={-1}>
              {item.account.name}
            </h1>
            <dl>
              <div>
                <dt>Tipo</dt>
                <dd>{typeLabel(item.account)}</dd>
              </div>
              <div>
                <dt>Estado</dt>
                <dd>{lifecycleLabel(item.account.lifecycle)}</dd>
              </div>
              <div>
                <dt>Moeda</dt>
                <dd>{item.account.currencyCode}</dd>
              </div>
              <div>
                <dt>Saldo contábil</dt>
                <dd>{formatBalance(item.balance)}</dd>
              </div>
            </dl>
            <p className="account-note">
              O saldo contábil vem da API e inclui o histórico da conta.
              Arquivar preserva esse histórico.
            </p>
            <div className="account-actions">
              {item.account.lifecycle === 'active' && (
                <button
                  disabled={busy}
                  onClick={() => void change('archive')}
                  type="button"
                >
                  Arquivar
                </button>
              )}
              {item.account.lifecycle === 'archived' && (
                <button
                  disabled={busy}
                  onClick={() => void change('unarchive')}
                  type="button"
                >
                  Desarquivar
                </button>
              )}
              {item.account.lifecycle !== 'trashed' && (
                <button
                  disabled={busy}
                  onClick={() => void change('move-to-trash')}
                  type="button"
                >
                  Mover para a lixeira
                </button>
              )}
              {item.account.lifecycle === 'trashed' && (
                <button
                  disabled={busy}
                  onClick={() => void change('restore-from-trash')}
                  type="button"
                >
                  Restaurar da lixeira
                </button>
              )}
            </div>
          </article>
        )}
      </main>
    </div>
  );
}
