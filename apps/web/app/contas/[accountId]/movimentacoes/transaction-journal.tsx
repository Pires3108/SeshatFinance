'use client';

import Link from 'next/link';
import {
  useCallback,
  useEffect,
  useState,
  type ReactNode,
  type SyntheticEvent,
} from 'react';

import {
  isAccountWithBalance,
  type AccountWithBalance,
} from '../../../accounts/account-contract';
import {
  isTransaction,
  validAmount,
  uuid,
  type Transaction,
} from '../../../transactions/transaction-contract';
import { RefundPanel } from './refund-panel';

interface Form {
  kind: 'income' | 'expense';
  amount: string;
  occurredAt: string;
  description: string;
  observations: string;
  counterpartyId: string;
  counterpartyName: string;
  categoryId: string;
  subcategoryId: string;
  costCenterId: string;
  tagIds: string;
}

const initial: Form = {
  kind: 'expense',
  amount: '',
  occurredAt: '',
  description: '',
  observations: '',
  counterpartyId: '',
  counterpartyName: '',
  categoryId: '',
  subcategoryId: '',
  costCenterId: '',
  tagIds: '',
};

function fromTransaction(item: Transaction): Form {
  const occurredAt = new Date(item.occurredAt);
  const localOccurredAt = new Date(
    occurredAt.getTime() - occurredAt.getTimezoneOffset() * 60_000,
  )
    .toISOString()
    .slice(0, 16);
  return {
    kind: item.kind,
    amount: item.amount,
    occurredAt: localOccurredAt,
    description: item.description ?? '',
    observations: item.observations ?? '',
    counterpartyId: item.counterpartyId ?? '',
    counterpartyName: item.counterpartyName ?? '',
    categoryId: item.categoryId ?? '',
    subcategoryId: item.subcategoryId ?? '',
    costCenterId: item.costCenterId ?? '',
    tagIds: item.tagIds.join(', '),
  };
}

type LifecycleAction =
  'archive' | 'unarchive' | 'move-to-trash' | 'restore-from-trash';

const lifecycleLabels: Readonly<Record<LifecycleAction, string>> = {
  archive: 'Arquivar',
  unarchive: 'Desarquivar',
  'move-to-trash': 'Mover para a lixeira',
  'restore-from-trash': 'Restaurar da lixeira',
};

const lifecycleMessages: Readonly<Record<LifecycleAction, string>> = {
  archive: 'Movimentação arquivada. Ela continua nos saldos.',
  unarchive: 'Movimentação desarquivada.',
  'move-to-trash':
    'Movimentação movida para a lixeira. Ela deixou de afetar os saldos.',
  'restore-from-trash':
    'Movimentação restaurada ao estado anterior. Ela voltou a afetar os saldos.',
};

function lifecycleActions(item: Transaction): readonly LifecycleAction[] {
  switch (item.lifecycle) {
    case 'active':
      return ['archive', 'move-to-trash'];
    case 'archived':
      return ['unarchive', 'move-to-trash'];
    case 'trashed':
      return ['restore-from-trash'];
  }
}

function money(item: Transaction): string {
  const [whole, fraction = ''] = item.amount.split('.');
  return `${whole?.replace(/\B(?=(\d{3})+(?!\d))/gu, '.') ?? '0'}${fraction ? `,${fraction}` : ''} ${item.currencyCode}`;
}

export function TransactionJournal({
  accountId,
}: {
  accountId: string;
}): ReactNode {
  const [account, setAccount] = useState<AccountWithBalance | null>(null);
  const [items, setItems] = useState<readonly Transaction[]>([]);
  const [state, setState] = useState<
    'loading' | 'ready' | 'unauthorized' | 'forbidden' | 'error'
  >('loading');
  const [form, setForm] = useState<Form>(initial);
  const [editing, setEditing] = useState<Transaction | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [retryKey, setRetryKey] = useState<string | null>(null);
  const [openDetails, setOpenDetails] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [view, setView] = useState<'ordinary' | 'trashed'>('ordinary');
  const [lifecycleBusyId, setLifecycleBusyId] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setState('loading');
    try {
      const [accountResponse, transactionResponse] = await Promise.all([
        fetch(`/api/accounts/${accountId}`, { cache: 'no-store' }),
        fetch(
          `/api/accounts/${accountId}/transactions${
            view === 'trashed' ? '?lifecycle=trashed' : ''
          }`,
          { cache: 'no-store' },
        ),
      ]);
      if (
        accountResponse.status === 401 ||
        transactionResponse.status === 401
      ) {
        setState('unauthorized');
        return;
      }
      if (
        accountResponse.status === 403 ||
        transactionResponse.status === 403
      ) {
        setState('forbidden');
        return;
      }
      if (!accountResponse.ok || !transactionResponse.ok) {
        setState('error');
        return;
      }
      const accountData: unknown = await accountResponse.json();
      const transactionData: unknown = await transactionResponse.json();
      if (
        !isAccountWithBalance(accountData) ||
        !Array.isArray(transactionData) ||
        !transactionData.every(isTransaction)
      ) {
        setState('error');
        return;
      }
      setAccount(accountData);
      setItems(transactionData);
      setState('ready');
    } catch {
      setState('error');
    }
  }, [accountId, view]);

  async function changeLifecycle(
    item: Transaction,
    action: LifecycleAction,
  ): Promise<void> {
    setLifecycleBusyId(item.id);
    setMessage('');
    try {
      const response = await fetch(`/api/transactions/${item.id}/lifecycle`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      if (response.status === 401) {
        setState('unauthorized');
        return;
      }
      if (!response.ok) {
        setMessage(
          response.status === 409
            ? 'Não foi possível alterar: a movimentação mudou, faz parte de uma transferência ou tem reembolsos vinculados. Recarregue e tente novamente.'
            : 'Não foi possível alterar a movimentação. Tente novamente.',
        );
        return;
      }
      setMessage(lifecycleMessages[action]);
      await load();
    } catch {
      setMessage('Não foi possível alterar a movimentação. Tente novamente.');
    } finally {
      setLifecycleBusyId(null);
    }
  }

  useEffect(() => {
    void load();
  }, [load]);

  function update(field: keyof Form, value: string): void {
    setRetryKey(null);
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function submit(
    event: SyntheticEvent<HTMLFormElement, SubmitEvent>,
  ): Promise<void> {
    event.preventDefault();
    if (account === null) return;
    const ids = [
      form.counterpartyId,
      form.categoryId,
      form.subcategoryId,
      form.costCenterId,
    ].filter(Boolean);
    const tagIds = form.tagIds
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
    if (
      !validAmount(form.amount, account.account.currencyMinorUnitScale) ||
      !form.occurredAt ||
      ids.some((id) => !uuid.test(id)) ||
      tagIds.some((id) => !uuid.test(id)) ||
      (form.counterpartyId && form.counterpartyName.trim())
    ) {
      setMessage(
        'Confira o valor, a data e os identificadores opcionais. Use entidade vinculada ou texto livre.',
      );
      return;
    }
    setBusy(true);
    setMessage('');
    const key = retryKey ?? crypto.randomUUID();
    setRetryKey(key);
    const payload = {
      amount: form.amount.replace(',', '.'),
      kind: form.kind,
      occurredAt:
        editing && form.occurredAt === fromTransaction(editing).occurredAt
          ? editing.occurredAt
          : new Date(form.occurredAt).toISOString(),
      description: form.description.trim() || null,
      observations: form.observations.trim() || null,
      counterpartyId: form.counterpartyId || null,
      counterpartyName: form.counterpartyName.trim() || null,
      categoryId: form.categoryId || null,
      subcategoryId: form.subcategoryId || null,
      costCenterId: form.costCenterId || null,
      tagIds: [...new Set(tagIds)],
      ...(editing ? { expectedVersion: editing.version } : {}),
      ...(editing
        ? {}
        : {
            currencyCode: account.account.currencyCode,
            currencyMinorUnitScale: account.account.currencyMinorUnitScale,
          }),
    };
    try {
      const response = await fetch(
        editing
          ? `/api/transactions/${editing.id}`
          : `/api/accounts/${accountId}/transactions`,
        {
          method: editing ? 'PATCH' : 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(editing ? {} : { 'Idempotency-Key': key }),
          },
          body: JSON.stringify(payload),
        },
      );
      if (response.status === 401) {
        setState('unauthorized');
        return;
      }
      if (response.status === 403) {
        setState('forbidden');
        return;
      }
      if (!response.ok) {
        setMessage(
          response.status === 409
            ? 'A movimentação foi alterada. Recarregue e tente novamente.'
            : 'Não foi possível salvar. Confira os dados e tente novamente.',
        );
        return;
      }
      const saved: unknown = await response.json();
      if (!isTransaction(saved)) {
        setMessage('A resposta da API foi inválida. Recarregue a página.');
        return;
      }
      setForm(initial);
      setEditing(null);
      setRetryKey(null);
      setMessage('Movimentação salva.');
      await load();
    } catch {
      setMessage('Não foi possível salvar. Tente novamente.');
    } finally {
      setBusy(false);
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
        <Link href={`/contas/${accountId}`}>Voltar à conta</Link>
      </header>
      <main className="accounts-page" id="main-content" tabIndex={-1}>
        <span className="section-label">Registros financeiros</span>
        <h1>Receitas e despesas</h1>
        {state === 'loading' && <p role="status">Carregando movimentações…</p>}
        {state === 'unauthorized' && (
          <p role="alert">
            Seu acesso expirou. <Link href="/entrar">Entre novamente</Link>.
          </p>
        )}
        {state === 'forbidden' && (
          <p role="alert">Você não tem acesso a estas movimentações.</p>
        )}
        {state === 'error' && (
          <p role="alert">
            Não foi possível carregar as movimentações.{' '}
            <button type="button" onClick={() => void load()}>
              Tentar novamente
            </button>
          </p>
        )}
        {state === 'ready' && account && (
          <>
            <p>
              Conta: {account.account.name} · {account.account.currencyCode}
            </p>
            <form
              className="account-detail transaction-form"
              onSubmit={(event) => void submit(event)}
            >
              <h2>
                {editing ? 'Editar movimentação' : 'Registrar movimentação'}
              </h2>
              <label>
                Tipo
                <select
                  value={form.kind}
                  onChange={(event) => {
                    update('kind', event.target.value);
                  }}
                  disabled={busy}
                >
                  <option value="income">Receita</option>
                  <option value="expense">Despesa</option>
                </select>
              </label>
              <label>
                Valor em {account.account.currencyCode}
                <input
                  required
                  inputMode="decimal"
                  value={form.amount}
                  onChange={(event) => {
                    update('amount', event.target.value);
                  }}
                  disabled={busy}
                />
              </label>
              <label>
                Data e hora
                <input
                  required
                  type="datetime-local"
                  value={form.occurredAt}
                  onChange={(event) => {
                    update('occurredAt', event.target.value);
                  }}
                  disabled={busy}
                />
              </label>
              <label>
                Descrição
                <input
                  value={form.description}
                  onChange={(event) => {
                    update('description', event.target.value);
                  }}
                  disabled={busy}
                />
              </label>
              <label>
                Observações
                <textarea
                  value={form.observations}
                  onChange={(event) => {
                    update('observations', event.target.value);
                  }}
                  disabled={busy}
                />
              </label>
              <label>
                Entidade vinculada (ID)
                <input
                  value={form.counterpartyId}
                  onChange={(event) => {
                    update('counterpartyId', event.target.value);
                  }}
                  disabled={busy}
                />
              </label>
              <label>
                Entidade em texto livre
                <input
                  value={form.counterpartyName}
                  onChange={(event) => {
                    update('counterpartyName', event.target.value);
                  }}
                  disabled={busy}
                />
              </label>
              <label>
                Categoria (ID)
                <input
                  value={form.categoryId}
                  onChange={(event) => {
                    update('categoryId', event.target.value);
                  }}
                  disabled={busy}
                />
              </label>
              <label>
                Subcategoria (ID)
                <input
                  value={form.subcategoryId}
                  onChange={(event) => {
                    update('subcategoryId', event.target.value);
                  }}
                  disabled={busy}
                />
              </label>
              <label>
                Centro de custo (ID)
                <input
                  value={form.costCenterId}
                  onChange={(event) => {
                    update('costCenterId', event.target.value);
                  }}
                  disabled={busy}
                />
              </label>
              <label>
                Etiquetas (IDs separados por vírgula)
                <input
                  value={form.tagIds}
                  onChange={(event) => {
                    update('tagIds', event.target.value);
                  }}
                  disabled={busy}
                />
              </label>
              {message && <p role="status">{message}</p>}
              <button type="submit" disabled={busy}>
                {busy ? 'Salvando…' : 'Salvar movimentação'}
              </button>
              {editing && (
                <button
                  type="button"
                  onClick={() => {
                    setEditing(null);
                    setForm(initial);
                    setMessage('');
                  }}
                  disabled={busy}
                >
                  Cancelar edição
                </button>
              )}
            </form>
            <h2>Histórico</h2>
            <label>
              Mostrar
              <select
                value={view}
                onChange={(event) => {
                  setView(
                    event.target.value === 'trashed' ? 'trashed' : 'ordinary',
                  );
                  setMessage('');
                }}
              >
                <option value="ordinary">Ativas e arquivadas</option>
                <option value="trashed">Lixeira</option>
              </select>
            </label>
            <p role="status">
              {items.length === 0
                ? 'Nenhuma movimentação nesta conta.'
                : `${String(items.length)} movimentações encontradas.`}
            </p>
            <ul className="account-list">
              {items.map((item) => (
                <li className="account-card" key={item.id}>
                  <h3>
                    {item.kind === 'income' ? 'Receita' : 'Despesa'} ·{' '}
                    {money(item)}
                  </h3>
                  <p>
                    {new Date(item.occurredAt).toLocaleString('pt-BR')} ·{' '}
                    {item.description ?? 'Sem descrição'}
                    {item.lifecycle === 'archived' && ' · Arquivada'}
                    {item.lifecycle === 'trashed' && ' · Na lixeira'}
                  </p>
                  <details
                    onToggle={(event) => {
                      const open = event.currentTarget.open;
                      setOpenDetails((current) => {
                        const next = new Set(current);
                        if (open) next.add(item.id);
                        else next.delete(item.id);
                        return next;
                      });
                    }}
                  >
                    <summary>Detalhes</summary>
                    <dl>
                      <div>
                        <dt>Observações</dt>
                        <dd>{item.observations ?? '—'}</dd>
                      </div>
                      <div>
                        <dt>Entidade</dt>
                        <dd>
                          {item.counterpartyName ?? item.counterpartyId ?? '—'}
                        </dd>
                      </div>
                      <div>
                        <dt>Categoria</dt>
                        <dd>{item.categoryId ?? '—'}</dd>
                      </div>
                      <div>
                        <dt>Subcategoria</dt>
                        <dd>{item.subcategoryId ?? '—'}</dd>
                      </div>
                      <div>
                        <dt>Centro de custo</dt>
                        <dd>{item.costCenterId ?? '—'}</dd>
                      </div>
                      <div>
                        <dt>Etiquetas</dt>
                        <dd>{item.tagIds.join(', ') || '—'}</dd>
                      </div>
                    </dl>
                    {item.kind === 'expense' && openDetails.has(item.id) && (
                      <RefundPanel expense={item} />
                    )}
                  </details>
                  {item.lifecycle === 'active' && (
                    <button
                      type="button"
                      onClick={() => {
                        setEditing(item);
                        setForm(fromTransaction(item));
                        setMessage('');
                        window.scrollTo({ top: 0, behavior: 'smooth' });
                      }}
                    >
                      Editar
                    </button>
                  )}
                  {lifecycleActions(item).map((action) => (
                    <button
                      key={action}
                      type="button"
                      disabled={lifecycleBusyId !== null}
                      onClick={() => void changeLifecycle(item, action)}
                    >
                      {lifecycleLabels[action]}
                    </button>
                  ))}
                </li>
              ))}
            </ul>
          </>
        )}
      </main>
    </div>
  );
}
