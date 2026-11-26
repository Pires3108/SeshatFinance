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

import type { paths } from '@seshat/contracts';

import {
  isAccountWithBalance,
  type Account,
} from '../accounts/account-contract';
import { formatMoney, parseDecimalInput } from '../metas/goal-presentation';

type BudgetView =
  paths['/api/v1/budgets']['get']['responses'][200]['content']['application/json'][number];
type DimensionKind = BudgetView['dimension']['kind'];
type Option = Readonly<{ id: string; name: string }>;
type LoadState = 'loading' | 'ready' | 'unauthorized' | 'unavailable';
type Message = Readonly<{ kind: 'error' | 'status'; text: string }>;

const dimensionLabels: Record<DimensionKind, string> = {
  account: 'Conta',
  category: 'Categoria',
  'cost-center': 'Centro de custo',
};

function isBudgetList(value: unknown): value is BudgetView[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        typeof item === 'object' &&
        item !== null &&
        typeof (item as Record<string, unknown>).id === 'string' &&
        typeof (item as Record<string, unknown>).month === 'string',
    )
  );
}

function isOptionList(value: unknown): value is Option[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        typeof item === 'object' &&
        item !== null &&
        typeof (item as Record<string, unknown>).id === 'string' &&
        typeof (item as Record<string, unknown>).name === 'string',
    )
  );
}

function currentMonth(): string {
  const now = new Date();
  return `${String(now.getFullYear())}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function monthLabel(month: string): string {
  const [year = '', value = ''] = month.split('-');
  return `${value}/${year}`;
}

/**
 * Monthly budgets per dimension (US-052). Realized comes from the expenses
 * of the month; going over the limit is an organizational warning and never
 * blocks, cancels or changes a payment.
 */
export function BudgetManager(): ReactNode {
  const [state, setState] = useState<LoadState>('loading');
  const [month, setMonth] = useState(currentMonth);
  const [budgets, setBudgets] = useState<readonly BudgetView[]>([]);
  const [options, setOptions] = useState<
    Readonly<Record<DimensionKind, readonly Option[]>>
  >({ account: [], category: [], 'cost-center': [] });
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<DimensionKind>('category');
  const [dimensionId, setDimensionId] = useState('');
  const [limit, setLimit] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);
  const keyRef = useRef<string>(crypto.randomUUID());

  const load = useCallback(async (selected: string): Promise<void> => {
    try {
      const response = await fetch(
        `/api/budgets?month=${encodeURIComponent(selected)}`,
        { cache: 'no-store' },
      );
      if (response.status === 401) {
        setState('unauthorized');
        return;
      }
      const data: unknown = response.ok ? await response.json() : null;
      if (!isBudgetList(data)) {
        setState('unavailable');
        return;
      }
      setBudgets(data);
      setState('ready');
    } catch {
      setState('unavailable');
    }
  }, []);

  const loadOptions = useCallback(async (): Promise<void> => {
    const read = async (url: string): Promise<unknown> => {
      try {
        const response = await fetch(url, { cache: 'no-store' });
        return response.ok ? await response.json() : null;
      } catch {
        return null;
      }
    };
    const [categories, costCenters, accounts] = await Promise.all([
      read('/api/categories'),
      read('/api/cost-centers'),
      read('/api/accounts?lifecycle=active'),
    ]);
    setOptions({
      account: Array.isArray(accounts)
        ? accounts
            .filter(isAccountWithBalance)
            .map(({ account }: { account: Account }) => ({
              id: account.id,
              name: account.name,
            }))
        : [],
      category: isOptionList(categories) ? categories : [],
      'cost-center': isOptionList(costCenters) ? costCenters : [],
    });
  }, []);

  useEffect(() => {
    void load(month);
  }, [load, month]);

  useEffect(() => {
    void loadOptions();
  }, [loadOptions]);

  function dimensionName(budget: BudgetView): string {
    const found = options[budget.dimension.kind].find(
      (item) => item.id === budget.dimension.id,
    );
    return `${dimensionLabels[budget.dimension.kind]}: ${found?.name ?? 'indisponível'}`;
  }

  async function create(event: SyntheticEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const amount = parseDecimalInput(limit);
    if (name.trim() === '' || dimensionId === '' || amount === null) {
      setMessage({
        kind: 'error',
        text: 'Informe nome, dimensão e um limite válido em BRL.',
      });
      return;
    }
    setBusy(true);
    try {
      const response = await fetch('/api/budgets', {
        body: JSON.stringify({
          currencyCode: 'BRL',
          currencyMinorUnitScale: 2,
          dimension: { id: dimensionId, kind },
          effectiveFrom: month,
          limit: amount,
          name: name.trim(),
        }),
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': keyRef.current,
        },
        method: 'POST',
      });
      keyRef.current = crypto.randomUUID();
      if (response.status === 409) {
        setMessage({
          kind: 'error',
          text: 'Já existe um orçamento ativo para essa dimensão e moeda.',
        });
        return;
      }
      if (!response.ok) {
        setMessage({
          kind: 'error',
          text: 'Não foi possível salvar o orçamento. Confira o mês (atual ou futuro) e tente novamente.',
        });
        return;
      }
      setMessage({ kind: 'status', text: `Orçamento salvo: ${name.trim()}` });
      setCreating(false);
      setName('');
      setLimit('');
      setDimensionId('');
      await load(month);
    } catch {
      setMessage({
        kind: 'error',
        text: 'Não foi possível salvar o orçamento.',
      });
    } finally {
      setBusy(false);
    }
  }

  async function archive(budget: BudgetView): Promise<void> {
    setBusy(true);
    try {
      const response = await fetch(`/api/budgets/${budget.id}/lifecycle`, {
        body: JSON.stringify({
          action: budget.lifecycle === 'active' ? 'archive' : 'unarchive',
          expectedVersion: budget.version,
        }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      });
      setMessage(
        response.ok
          ? {
              kind: 'status',
              text:
                budget.lifecycle === 'active'
                  ? `Orçamento arquivado: ${budget.name}`
                  : `Orçamento desarquivado: ${budget.name}`,
            }
          : {
              kind: 'error',
              text: 'Não foi possível alterar o orçamento. Atualize a página e tente novamente.',
            },
      );
      await load(month);
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
        <Link href="/contas">Contas</Link>
        <Link href="/metas">Metas</Link>
        <Link href="/preferencias">Preferências</Link>
      </header>
      <main className="accounts-page" id="main-content" tabIndex={-1}>
        <div className="accounts-heading">
          <div>
            <span className="section-label">Planejamento</span>
            <h1>Orçamentos</h1>
            <p>
              Compare o previsto com as despesas do mês. Passar do limite gera
              só um aviso: nenhum pagamento é bloqueado, cancelado ou alterado.
            </p>
          </div>
          {!creating && state === 'ready' && (
            <button
              onClick={() => {
                setCreating(true);
                setMessage(null);
              }}
              type="button"
            >
              Criar orçamento
            </button>
          )}
        </div>
        <label className="budget-month">
          Mês
          <input
            onChange={(event) => {
              if (/^\d{4}-\d{2}$/u.test(event.target.value)) {
                setMonth(event.target.value);
              }
            }}
            type="month"
            value={month}
          />
        </label>
        {message !== null && (
          <p
            className={message.kind === 'error' ? 'form-message error' : ''}
            role={message.kind === 'error' ? 'alert' : 'status'}
          >
            {message.text}
          </p>
        )}
        {creating && (
          <form
            aria-label="Criar orçamento"
            className="account-form"
            noValidate
            onSubmit={(event) => void create(event)}
          >
            <label>
              Nome
              <input
                maxLength={120}
                onChange={(event) => {
                  setName(event.target.value);
                }}
                value={name}
              />
            </label>
            <label>
              Dimensão
              <select
                onChange={(event) => {
                  setKind(event.target.value as DimensionKind);
                  setDimensionId('');
                }}
                value={kind}
              >
                <option value="category">Categoria</option>
                <option value="cost-center">Centro de custo</option>
                <option value="account">Conta</option>
              </select>
            </label>
            <label>
              {dimensionLabels[kind]}
              <select
                onChange={(event) => {
                  setDimensionId(event.target.value);
                }}
                value={dimensionId}
              >
                <option value="">Selecione</option>
                {options[kind].map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Limite mensal (BRL)
              <input
                inputMode="decimal"
                onChange={(event) => {
                  setLimit(event.target.value);
                }}
                value={limit}
              />
            </label>
            <p className="account-note">
              O limite vale a partir de {monthLabel(month)}; meses anteriores
              não mudam.
            </p>
            <div className="account-actions">
              <button disabled={busy} type="submit">
                Salvar orçamento
              </button>
              <button
                disabled={busy}
                onClick={() => {
                  setCreating(false);
                }}
                type="button"
              >
                Cancelar
              </button>
            </div>
          </form>
        )}
        {state === 'loading' && <p>Carregando orçamentos…</p>}
        {state === 'unauthorized' && (
          <p role="alert">
            Seu acesso expirou. <Link href="/entrar">Entre novamente</Link> para
            consultar seus orçamentos.
          </p>
        )}
        {state === 'unavailable' && (
          <p role="alert">Orçamentos indisponíveis no momento.</p>
        )}
        {state === 'ready' && budgets.length === 0 && !creating && (
          <p>Nenhum orçamento criado.</p>
        )}
        {state === 'ready' && budgets.length > 0 && (
          <ul
            aria-label={`Orçamentos de ${monthLabel(month)}`}
            className="loan-list"
          >
            {budgets.map((budget) => (
              <li key={budget.id}>
                <h2>{budget.name}</h2>
                <p>
                  {dimensionName(budget)}
                  {budget.lifecycle === 'archived' && ' · Arquivado'}
                </p>
                {budget.consumption === null ? (
                  <p>Este orçamento começa depois de {monthLabel(month)}.</p>
                ) : (
                  <dl className="budget-figures">
                    <div>
                      <dt>Previsto</dt>
                      <dd>{formatMoney(budget.consumption.planned)}</dd>
                    </div>
                    <div>
                      <dt>Realizado</dt>
                      <dd>{formatMoney(budget.consumption.realized)}</dd>
                    </div>
                    <div>
                      <dt>Restante</dt>
                      <dd>{formatMoney(budget.consumption.remaining)}</dd>
                    </div>
                    <div>
                      <dt>Excedente</dt>
                      <dd>{formatMoney(budget.consumption.excess)}</dd>
                    </div>
                  </dl>
                )}
                {budget.consumption?.exceeded === true && (
                  <p className="form-message warning">
                    Aviso: orçamento excedido em{' '}
                    {formatMoney(budget.consumption.excess)}. É só um aviso
                    organizacional; nenhum pagamento foi bloqueado.
                  </p>
                )}
                {budget.otherCurrencyEntries > 0 && (
                  <p className="account-note">
                    {budget.otherCurrencyEntries} despesa(s) em outra moeda não
                    entram no realizado.
                  </p>
                )}
                <div className="account-actions">
                  <button
                    disabled={busy}
                    onClick={() => void archive(budget)}
                    type="button"
                  >
                    {budget.lifecycle === 'active' ? 'Arquivar' : 'Desarquivar'}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
