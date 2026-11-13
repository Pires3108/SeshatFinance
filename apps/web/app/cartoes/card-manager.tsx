'use client';

import Link from 'next/link';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type SyntheticEvent,
  type ReactNode,
} from 'react';

import type { AccountWithBalance } from '../accounts/account-contract';
import { CardInvoices } from './card-invoices';
import { CardPurchases } from './card-purchases';
import {
  boundaryLabels,
  cycleSummary,
  dueShiftNote,
  formatLimit,
  isCardCycle,
  isCardList,
  type Card,
  type CardCycle,
  type ClosingBoundary,
} from './card-presentation';

type LoadState = 'loading' | 'ready' | 'unauthorized' | 'unavailable';
type Draft = Readonly<{
  attentionDays: string;
  brand: string;
  closingBoundary: ClosingBoundary;
  closingDay: string;
  dueDay: string;
  limit: string;
  name: string;
  paymentAccountId: string;
}>;

const emptyDraft: Draft = {
  attentionDays: '5',
  brand: '',
  closingBoundary: 'next-cycle',
  closingDay: '',
  dueDay: '',
  limit: '',
  name: '',
  paymentAccountId: '',
};

const DECIMAL = /^\d+(?:[.,]\d+)?$/u;

function draftOf(card: Card): Draft {
  return {
    attentionDays: String(card.attentionDays),
    brand: card.brand,
    closingBoundary: card.closingBoundary,
    closingDay: String(card.closingDay),
    dueDay: String(card.dueDay),
    limit: card.limit,
    name: card.name,
    paymentAccountId: card.paymentAccountId,
  };
}

function validDay(value: string): number | null {
  if (!/^\d{1,2}$/u.test(value)) return null;
  const day = Number(value);
  return day >= 1 && day <= 31 ? day : null;
}

function validationError(draft: Draft, creating: boolean): string | null {
  if (draft.name.trim() === '') return 'Informe o nome do cartão.';
  if (draft.brand.trim() === '') return 'Informe a bandeira.';
  if (creating && draft.paymentAccountId === '')
    return 'Escolha a conta pagadora.';
  if (!DECIMAL.test(draft.limit.trim()))
    return 'Informe o limite com números, por exemplo 3500,00.';
  if (validDay(draft.closingDay) === null || validDay(draft.dueDay) === null)
    return 'Os dias de fechamento e vencimento devem estar entre 1 e 31.';
  if (
    !/^\d{1,2}$/u.test(draft.attentionDays) ||
    Number(draft.attentionDays) > 30
  )
    return 'A antecedência do aviso deve estar entre 0 e 30 dias.';
  return null;
}

export function CardManager(): ReactNode {
  const [state, setState] = useState<LoadState>('loading');
  const [cards, setCards] = useState<readonly Card[]>([]);
  const [cycles, setCycles] = useState<Readonly<Record<string, CardCycle>>>({});
  const [accounts, setAccounts] = useState<readonly AccountWithBalance[]>([]);
  const [editing, setEditing] = useState<Card | 'new' | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [message, setMessage] = useState<Readonly<{
    kind: 'status' | 'error';
    text: ReactNode;
  }> | null>(null);
  const [saving, setSaving] = useState(false);
  const [refreshTokens, setRefreshTokens] = useState<
    Readonly<Record<string, number>>
  >({});
  const messageRef = useRef<HTMLParagraphElement>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      const [cardResponse, accountResponse] = await Promise.all([
        fetch('/api/cards', { cache: 'no-store' }),
        fetch('/api/accounts?lifecycle=active', { cache: 'no-store' }),
      ]);
      if (cardResponse.status === 401 || accountResponse.status === 401) {
        setState('unauthorized');
        return;
      }
      const cardData: unknown = await cardResponse.json();
      if (!cardResponse.ok || !accountResponse.ok || !isCardList(cardData)) {
        setState('unavailable');
        return;
      }
      setAccounts((await accountResponse.json()) as AccountWithBalance[]);
      setCards(cardData);
      const entries = await Promise.all(
        cardData.map(async (card) => {
          const response = await fetch(`/api/cards/${card.id}/cycle`, {
            cache: 'no-store',
          });
          const data: unknown = response.ok ? await response.json() : null;
          return isCardCycle(data) ? ([card.id, data] as const) : null;
        }),
      );
      setCycles(
        Object.fromEntries(
          entries.filter(
            (entry): entry is readonly [string, CardCycle] => entry !== null,
          ),
        ),
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

  function open(target: Card | 'new'): void {
    setEditing(target);
    setDraft(target === 'new' ? emptyDraft : draftOf(target));
    setMessage(null);
  }

  async function submit(
    event: SyntheticEvent<HTMLFormElement, SubmitEvent>,
  ): Promise<void> {
    event.preventDefault();
    if (editing === null || saving) return;
    const creating = editing === 'new';
    const invalid = validationError(draft, creating);
    if (invalid !== null) {
      setMessage({ kind: 'error', text: invalid });
      return;
    }
    const settings = {
      attentionDays: Number(draft.attentionDays),
      brand: draft.brand.trim(),
      closingBoundary: draft.closingBoundary,
      closingDay: validDay(draft.closingDay),
      dueDay: validDay(draft.dueDay),
      limit: draft.limit.trim().replace(',', '.'),
      name: draft.name.trim(),
    };
    const account = accounts.find(
      (item) => item.account.id === draft.paymentAccountId,
    )?.account;
    setSaving(true);
    try {
      const response = await fetch(
        creating ? '/api/cards' : `/api/cards/${editing.id}`,
        {
          body: JSON.stringify(
            creating
              ? {
                  ...settings,
                  currencyCode: account?.currencyCode,
                  currencyMinorUnitScale: account?.currencyMinorUnitScale,
                  paymentAccountId: draft.paymentAccountId,
                }
              : { ...settings, expectedVersion: editing.version },
          ),
          cache: 'no-store',
          headers: { 'Content-Type': 'application/json' },
          method: creating ? 'POST' : 'PATCH',
        },
      );
      if (response.status === 401) {
        setMessage({
          kind: 'error',
          text: (
            <>
              Sua sessão expirou. <Link href="/entrar">Entre novamente</Link>.
            </>
          ),
        });
        return;
      }
      if (response.status === 409) {
        setMessage({
          kind: 'error',
          text: 'O cartão foi alterado em outra sessão. Recarregue a página e tente novamente.',
        });
        return;
      }
      if (!response.ok) {
        setMessage({
          kind: 'error',
          text: 'Não foi possível salvar o cartão. Confira os dados e tente novamente.',
        });
        return;
      }
      setEditing(null);
      await load();
      setMessage({
        kind: 'status',
        text: creating ? 'Cartão cadastrado.' : 'Cartão atualizado.',
      });
    } catch {
      setMessage({
        kind: 'error',
        text: 'Não foi possível salvar o cartão. Tente novamente.',
      });
    } finally {
      setSaving(false);
    }
  }

  function field(
    key: keyof Draft,
    label: string,
    props: Readonly<{ inputMode?: 'numeric' | 'decimal'; note?: string }> = {},
  ): ReactNode {
    const id = `card-${key}`;
    return (
      <div className="field">
        <label htmlFor={id}>{label}</label>
        <input
          aria-describedby={props.note === undefined ? undefined : `${id}-note`}
          id={id}
          inputMode={props.inputMode}
          onChange={(event) => {
            setDraft({ ...draft, [key]: event.target.value });
          }}
          value={draft[key]}
        />
        {props.note !== undefined && (
          <p className="field-note" id={`${id}-note`}>
            {props.note}
          </p>
        )}
      </div>
    );
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
        <Link href="/preferencias">Preferências</Link>
      </header>
      <main className="accounts-page" id="main-content" tabIndex={-1}>
        <div className="accounts-heading">
          <div>
            <span className="section-label">Seus registros</span>
            <h1>Cartões</h1>
            <p>
              Organize seus cartões de crédito e acompanhe o ciclo de cada
              fatura. O Seshat apenas registra: nada aqui realiza compras,
              pagamentos ou altera o limite real do cartão.
            </p>
          </div>
          <button
            disabled={state !== 'ready'}
            onClick={() => {
              open('new');
            }}
            type="button"
          >
            Cadastrar cartão
          </button>
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
        {state === 'loading' && <p role="status">Carregando cartões…</p>}
        {state === 'unauthorized' && (
          <p role="alert">
            Seu acesso expirou. <Link href="/entrar">Entre novamente</Link> para
            consultar seus cartões.
          </p>
        )}
        {state === 'unavailable' && (
          <p role="alert">
            Não foi possível carregar os cartões.{' '}
            <button onClick={() => void load()} type="button">
              Tentar novamente
            </button>
            .
          </p>
        )}
        {editing !== null && (
          <form
            aria-label={
              editing === 'new' ? 'Cadastrar cartão' : 'Editar cartão'
            }
            className="form-panel"
            onSubmit={(event) => void submit(event)}
          >
            <h2>
              {editing === 'new' ? 'Novo cartão' : `Editar ${editing.name}`}
            </h2>
            {field('name', 'Nome')}
            {field('brand', 'Bandeira')}
            {editing === 'new' ? (
              <div className="field">
                <label htmlFor="card-paymentAccountId">Conta pagadora</label>
                <select
                  id="card-paymentAccountId"
                  onChange={(event) => {
                    setDraft({
                      ...draft,
                      paymentAccountId: event.target.value,
                    });
                  }}
                  value={draft.paymentAccountId}
                >
                  <option value="">Escolha uma conta ativa</option>
                  {accounts.map(({ account }) => (
                    <option key={account.id} value={account.id}>
                      {account.name} ({account.currencyCode})
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
            {field('limit', 'Limite', {
              inputMode: 'decimal',
              note: 'Estimativa organizacional na moeda da conta pagadora. Não bloqueia nem libera limite real.',
            })}
            {field('closingDay', 'Dia de fechamento', {
              inputMode: 'numeric',
              note: 'Em meses mais curtos, vale o último dia do mês.',
            })}
            {field('dueDay', 'Dia de vencimento', {
              inputMode: 'numeric',
              note: 'Se cair em fim de semana ou feriado do seu local, passa para o próximo dia útil.',
            })}
            {field('attentionDays', 'Avisar quantos dias antes do vencimento', {
              inputMode: 'numeric',
              note: 'A fatura com saldo devedor aparece em “Atenção” a partir desse número de dias antes do vencimento (de 0 a 30).',
            })}
            <fieldset className="field">
              <legend>Compras feitas no dia do fechamento</legend>
              {(['next-cycle', 'closing-cycle'] as const).map((value) => (
                <label key={value}>
                  <input
                    checked={draft.closingBoundary === value}
                    name="card-closing-boundary"
                    onChange={() => {
                      setDraft({ ...draft, closingBoundary: value });
                    }}
                    type="radio"
                  />{' '}
                  {boundaryLabels[value]}
                </label>
              ))}
            </fieldset>
            <div className="account-actions">
              <button disabled={saving} type="submit">
                {saving ? 'Salvando…' : 'Salvar cartão'}
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
        {state === 'ready' && cards.length === 0 && editing === null && (
          <p>Você ainda não cadastrou cartões.</p>
        )}
        {state === 'ready' && cards.length > 0 && (
          <ul className="account-list">
            {cards.map((card) => {
              const cycle = cycles[card.id];
              const shift = cycle === undefined ? null : dueShiftNote(cycle);
              return (
                <li className="account-card" key={card.id}>
                  <div>
                    <h2>{card.name}</h2>
                    <p>
                      {card.brand} · fecha dia {card.closingDay} · vence dia{' '}
                      {card.dueDay}
                    </p>
                    <p>{boundaryLabels[card.closingBoundary]}.</p>
                    {cycle === undefined ? (
                      <p>Ciclo da fatura indisponível no momento.</p>
                    ) : (
                      <>
                        <p>{cycleSummary(cycle)}</p>
                        {shift !== null && (
                          <p className="field-note">{shift}</p>
                        )}
                      </>
                    )}
                  </div>
                  <p className="account-balance">
                    <span>Limite organizacional</span>
                    <strong>{formatLimit(card)}</strong>
                  </p>
                  <CardPurchases
                    card={card}
                    cycleClosesOn={cycle?.closesOn ?? null}
                    onRecorded={() => {
                      setRefreshTokens((tokens) => ({
                        ...tokens,
                        [card.id]: (tokens[card.id] ?? 0) + 1,
                      }));
                    }}
                  />
                  <CardInvoices
                    card={card}
                    refreshToken={refreshTokens[card.id] ?? 0}
                  />
                  <div className="account-actions">
                    <button
                      onClick={() => {
                        open(card);
                      }}
                      type="button"
                    >
                      Editar
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <p className="field-note">
          Os vencimentos consideram fins de semana, feriados nacionais, 31/12 e
          os feriados do local configurado em{' '}
          <Link href="/preferencias">Preferências</Link>.
        </p>
      </main>
    </div>
  );
}
