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

import {
  isAccountWithBalance,
  type Account,
} from '../accounts/account-contract';
import { formatCivilDate } from '../cartoes/card-presentation';
import {
  conversionText,
  formatMoney,
  formatPercent,
  isGoal,
  isGoalList,
  parseDecimalInput,
  statusLabels,
  type GoalView,
} from './goal-presentation';

type LoadState = 'loading' | 'ready' | 'unauthorized' | 'unavailable';
type ShareDraft = Readonly<{
  selected: boolean;
  kind: 'full' | 'amount';
  amount: string;
}>;
type Draft = Readonly<{
  name: string;
  target: string;
  currencyCode: 'BRL' | 'USD' | 'EUR';
  initialAmount: string;
  deadline: string;
  mode: 'free' | 'linked';
  shares: Readonly<Record<string, ShareDraft>>;
}>;
type Message = Readonly<{ kind: 'status' | 'error'; text: string }>;

const emptyDraft: Draft = {
  currencyCode: 'BRL',
  deadline: '',
  initialAmount: '',
  mode: 'free',
  name: '',
  shares: {},
  target: '',
};

const errorTexts: Record<number, string> = {
  404: 'Uma das contas escolhidas não está disponível.',
  409: 'A meta foi alterada em outra janela. Recarregamos os dados; revise e tente de novo.',
  422: 'As fatias declaradas passam do saldo da conta ou uma conta já está inteira em outra meta.',
};

/** Goals declared by the holder (US-049). Nothing here moves money. */
export function GoalManager(): ReactNode {
  const [state, setState] = useState<LoadState>('loading');
  const [goals, setGoals] = useState<readonly GoalView[]>([]);
  const [accounts, setAccounts] = useState<readonly Account[]>([]);
  const [editing, setEditing] = useState<GoalView | 'new' | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);
  const keyRef = useRef('');
  const messageRef = useRef<HTMLParagraphElement>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      const [goalResponse, accountResponse] = await Promise.all([
        fetch('/api/goals', { cache: 'no-store' }),
        fetch('/api/accounts?lifecycle=active', { cache: 'no-store' }),
      ]);
      if (goalResponse.status === 401 || accountResponse.status === 401) {
        setState('unauthorized');
        return;
      }
      const goalData: unknown = goalResponse.ok
        ? await goalResponse.json()
        : null;
      const accountData: unknown = accountResponse.ok
        ? await accountResponse.json()
        : null;
      if (!isGoalList(goalData) || !Array.isArray(accountData)) {
        setState('unavailable');
        return;
      }
      setGoals(goalData);
      setAccounts(
        accountData.filter(isAccountWithBalance).map((item) => item.account),
      );
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

  function startNew(): void {
    keyRef.current = crypto.randomUUID();
    setDraft(emptyDraft);
    setMessage(null);
    setEditing('new');
  }

  function startEdit(goal: GoalView): void {
    const shares: Record<string, ShareDraft> = {};
    for (const link of goal.links) {
      shares[link.accountId] = {
        amount: link.share.amount?.amount.replace('.', ',') ?? '',
        kind: link.share.kind === 'full' ? 'full' : 'amount',
        selected: true,
      };
    }
    setDraft({
      currencyCode: goal.target.currencyCode as Draft['currencyCode'],
      deadline: goal.deadline ?? '',
      initialAmount: goal.initialAmount.amount.replace('.', ','),
      mode: goal.mode === 'linked' ? 'linked' : 'free',
      name: goal.name,
      shares,
      target: goal.target.amount.replace('.', ','),
    });
    setMessage(null);
    setEditing(goal);
  }

  function payload(): Record<string, unknown> | string {
    const target = parseDecimalInput(draft.target);
    if (target === null) return 'Informe o alvo, por exemplo 500,00.';
    const initial =
      draft.initialAmount.trim() === ''
        ? null
        : parseDecimalInput(draft.initialAmount);
    if (initial === null && draft.initialAmount.trim() !== '') {
      return 'Valor inicial inválido.';
    }
    const links: { accountId: string; share: Record<string, string> }[] = [];
    if (draft.mode === 'linked') {
      for (const [accountId, share] of Object.entries(draft.shares)) {
        if (!share.selected) continue;
        if (share.kind === 'full') {
          links.push({ accountId, share: { kind: 'full' } });
          continue;
        }
        const amount = parseDecimalInput(share.amount);
        if (amount === null) return 'Informe o valor da fatia de cada conta.';
        links.push({ accountId, share: { amount, kind: 'amount' } });
      }
      if (links.length === 0) return 'Escolha ao menos uma conta.';
    }
    return {
      currencyCode: draft.currencyCode,
      currencyMinorUnitScale: 2,
      deadline: draft.deadline === '' ? null : draft.deadline,
      initialAmount: initial,
      links,
      mode: draft.mode,
      name: draft.name,
      target,
    };
  }

  async function submit(
    event: SyntheticEvent<HTMLFormElement, SubmitEvent>,
  ): Promise<void> {
    event.preventDefault();
    if (saving || editing === null) return;
    const body = payload();
    if (typeof body === 'string') {
      setMessage({ kind: 'error', text: body });
      return;
    }
    setSaving(true);
    try {
      const response =
        editing === 'new'
          ? await fetch('/api/goals', {
              body: JSON.stringify(body),
              cache: 'no-store',
              headers: {
                'Content-Type': 'application/json',
                'Idempotency-Key': keyRef.current,
              },
              method: 'POST',
            })
          : await fetch(`/api/goals/${editing.id}`, {
              body: JSON.stringify({
                ...body,
                expectedVersion: editing.version,
              }),
              cache: 'no-store',
              headers: { 'Content-Type': 'application/json' },
              method: 'PUT',
            });
      const data: unknown = response.ok ? await response.json() : null;
      if (!isGoal(data)) {
        if (response.status === 409) await load();
        setMessage({
          kind: 'error',
          text:
            errorTexts[response.status] ??
            'Não foi possível salvar a meta. Confira os dados e tente novamente.',
        });
        return;
      }
      setEditing(null);
      setMessage({
        kind: 'status',
        text: `Meta salva: ${data.name}, alvo ${formatMoney(data.target)}. Saldos e patrimônio não mudam.`,
      });
      await load();
    } catch {
      setMessage({
        kind: 'error',
        text: 'Não foi possível salvar a meta. Tente novamente.',
      });
    } finally {
      setSaving(false);
    }
  }

  async function lifecycle(
    goal: GoalView,
    action: 'pause' | 'resume' | 'archive' | 'unarchive',
  ): Promise<void> {
    setSaving(true);
    try {
      const response = await fetch(`/api/goals/${goal.id}/lifecycle`, {
        body: JSON.stringify({ action, expectedVersion: goal.version }),
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      });
      setMessage(
        response.ok
          ? { kind: 'status', text: `Meta ${goal.name} atualizada.` }
          : {
              kind: 'error',
              text:
                errorTexts[response.status] ??
                'Não foi possível alterar a meta.',
            },
      );
      await load();
    } catch {
      setMessage({ kind: 'error', text: 'Não foi possível alterar a meta.' });
    } finally {
      setSaving(false);
    }
  }

  function setShare(accountId: string, change: Partial<ShareDraft>): void {
    const current = draft.shares[accountId] ?? {
      amount: '',
      kind: 'full',
      selected: false,
    };
    setDraft({
      ...draft,
      shares: { ...draft.shares, [accountId]: { ...current, ...change } },
    });
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
        <Link href="/emprestimos">Empréstimos</Link>
        <Link href="/preferencias">Preferências</Link>
      </header>
      <main className="accounts-page" id="main-content" tabIndex={-1}>
        <div className="accounts-heading">
          <div>
            <span className="section-label">Planejamento</span>
            <h1>Metas</h1>
            <p>
              Acompanhe objetivos com alvo, prazo e contas relacionadas. Criar
              ou editar uma meta não move dinheiro nem altera saldos e
              patrimônio.
            </p>
          </div>
          {editing === null && state === 'ready' && (
            <button onClick={startNew} type="button">
              Criar meta
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
        {editing !== null && (
          <form
            aria-label={editing === 'new' ? 'Criar meta' : 'Editar meta'}
            className="account-form"
            onSubmit={(event) => void submit(event)}
          >
            <label>
              Nome
              <input
                maxLength={120}
                onChange={(event) => {
                  setDraft({ ...draft, name: event.target.value });
                }}
                required
                value={draft.name}
              />
            </label>
            <label>
              Alvo
              <input
                inputMode="decimal"
                onChange={(event) => {
                  setDraft({ ...draft, target: event.target.value });
                }}
                placeholder="500,00"
                required
                value={draft.target}
              />
            </label>
            <label>
              Moeda da meta
              <select
                onChange={(event) => {
                  setDraft({
                    ...draft,
                    currencyCode: event.target.value as Draft['currencyCode'],
                  });
                }}
                value={draft.currencyCode}
              >
                <option value="BRL">BRL</option>
                <option value="USD">USD</option>
                <option value="EUR">EUR</option>
              </select>
            </label>
            <label>
              Valor inicial (opcional)
              <input
                inputMode="decimal"
                onChange={(event) => {
                  setDraft({ ...draft, initialAmount: event.target.value });
                }}
                value={draft.initialAmount}
              />
            </label>
            <label>
              Prazo (opcional)
              <input
                onChange={(event) => {
                  setDraft({ ...draft, deadline: event.target.value });
                }}
                type="date"
                value={draft.deadline}
              />
            </label>
            <fieldset>
              <legend>Tipo de meta</legend>
              <label>
                <input
                  checked={draft.mode === 'free'}
                  name="goal-mode"
                  onChange={() => {
                    setDraft({ ...draft, mode: 'free' });
                  }}
                  type="radio"
                />{' '}
                Livre (sem conta)
              </label>{' '}
              <label>
                <input
                  checked={draft.mode === 'linked'}
                  name="goal-mode"
                  onChange={() => {
                    setDraft({ ...draft, mode: 'linked' });
                  }}
                  type="radio"
                />{' '}
                Vinculada a contas
              </label>
            </fieldset>
            {draft.mode === 'linked' && (
              <fieldset>
                <legend>Contas da meta</legend>
                {accounts.length === 0 && <p>Nenhuma conta ativa.</p>}
                {accounts.map((account) => {
                  const share = draft.shares[account.id];
                  const label = `${account.name} (${account.currencyCode})`;
                  return (
                    <div key={account.id}>
                      <label>
                        <input
                          checked={share?.selected === true}
                          onChange={(event) => {
                            setShare(account.id, {
                              selected: event.target.checked,
                            });
                          }}
                          type="checkbox"
                        />{' '}
                        {label}
                      </label>
                      {share?.selected === true && (
                        <>
                          <label>
                            Quanto conta para a meta em {account.name}
                            <select
                              onChange={(event) => {
                                setShare(account.id, {
                                  kind: event.target
                                    .value as ShareDraft['kind'],
                                });
                              }}
                              value={share.kind}
                            >
                              <option value="full">
                                Saldo inteiro (só esta meta)
                              </option>
                              <option value="amount">Uma fatia do saldo</option>
                            </select>
                          </label>
                          {share.kind === 'amount' && (
                            <label>
                              Fatia em {account.currencyCode} de {account.name}
                              <input
                                inputMode="decimal"
                                onChange={(event) => {
                                  setShare(account.id, {
                                    amount: event.target.value,
                                  });
                                }}
                                value={share.amount}
                              />
                            </label>
                          )}
                        </>
                      )}
                    </div>
                  );
                })}
              </fieldset>
            )}
            <div className="account-actions">
              <button disabled={saving} type="submit">
                {saving ? 'Salvando…' : 'Salvar meta'}
              </button>
              <button
                disabled={saving}
                onClick={() => {
                  setEditing(null);
                }}
                type="button"
              >
                Cancelar
              </button>
            </div>
          </form>
        )}
        {state === 'loading' && <p role="status">Carregando metas…</p>}
        {state === 'unauthorized' && (
          <p role="alert">
            Seu acesso expirou. <Link href="/entrar">Entre novamente</Link> para
            consultar suas metas.
          </p>
        )}
        {state === 'unavailable' && (
          <p role="alert">Metas indisponíveis no momento.</p>
        )}
        {state === 'ready' && goals.length === 0 && editing === null && (
          <p>Nenhuma meta criada.</p>
        )}
        {state === 'ready' && goals.length > 0 && (
          <ul className="loan-list">
            {goals.map((goal) => (
              <li key={goal.id}>
                <h2>{goal.name}</h2>
                <p>
                  <strong>{statusLabels[goal.progress.status]}</strong> · Alvo{' '}
                  {formatMoney(goal.target)}
                  {goal.deadline !== null &&
                    ` até ${formatCivilDate(goal.deadline)}`}
                </p>
                {goal.progress.accumulated === null ? (
                  <p>
                    Progresso convertido indisponível: falta cotação para uma
                    das contas.
                  </p>
                ) : (
                  <p>
                    Acumulado {formatMoney(goal.progress.accumulated)}
                    {goal.progress.percent !== null &&
                      ` (${formatPercent(goal.progress.percent)})`}
                    {goal.progress.remaining !== null &&
                      ` · Restante ${formatMoney(goal.progress.remaining)}`}
                  </p>
                )}
                {goal.links.length > 0 && (
                  <ul aria-label={`Contas de ${goal.name}`}>
                    {goal.links.map((link) => (
                      <li key={link.accountId}>
                        {link.accountName ?? 'Conta indisponível'}:{' '}
                        {formatMoney(link.counted)}
                        {link.share.kind === 'amount' && link.share.amount
                          ? ` (fatia de ${formatMoney(link.share.amount)})`
                          : ' (saldo inteiro)'}
                        {link.excluded && ' · Conta na lixeira: não conta'}
                        {link.belowDeclaredShares &&
                          ' · Saldo da conta abaixo das fatias declaradas'}
                        {conversionText(link) !== '' &&
                          ` · ${conversionText(link)}`}
                      </li>
                    ))}
                  </ul>
                )}
                <div className="account-actions">
                  {goal.lifecycle !== 'archived' && (
                    <button
                      disabled={saving}
                      onClick={() => {
                        startEdit(goal);
                      }}
                      type="button"
                    >
                      Editar
                    </button>
                  )}
                  {goal.lifecycle === 'active' && (
                    <button
                      disabled={saving}
                      onClick={() => void lifecycle(goal, 'pause')}
                      type="button"
                    >
                      Pausar
                    </button>
                  )}
                  {goal.lifecycle === 'paused' && (
                    <button
                      disabled={saving}
                      onClick={() => void lifecycle(goal, 'resume')}
                      type="button"
                    >
                      Retomar
                    </button>
                  )}
                  {goal.lifecycle !== 'archived' ? (
                    <button
                      disabled={saving}
                      onClick={() => void lifecycle(goal, 'archive')}
                      type="button"
                    >
                      Arquivar
                    </button>
                  ) : (
                    <button
                      disabled={saving}
                      onClick={() => void lifecycle(goal, 'unarchive')}
                      type="button"
                    >
                      Desarquivar
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
