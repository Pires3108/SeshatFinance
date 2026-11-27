'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type SyntheticEvent,
} from 'react';

import type { paths } from '@seshat/contracts';

import type { AccountWithBalance } from '../accounts/account-contract';

type EventView =
  paths['/api/v1/investments/{investmentId}/events']['get']['responses'][200]['content']['application/json'][number];
type EventBody = NonNullable<
  paths['/api/v1/investments/{investmentId}/events']['post']['requestBody']
>['content']['application/json'];
type EventKind = EventView['kind'];
type Investment = Readonly<{
  id: string;
  name: string;
  currencyCode: string;
  lifecycle: string;
  quantityScale: number | null;
}>;

export const eventKindLabels: Readonly<Record<EventKind, string>> = {
  contribution: 'Aporte',
  dividend: 'Dividendo',
  fee: 'Taxa',
  interest: 'Juros',
  redemption: 'Resgate',
  tax: 'Imposto',
  yield: 'Rendimento',
};

const movementKinds = new Set<EventKind>(['contribution', 'redemption']);
const accountlessKinds = new Set<EventKind>(['fee', 'tax']);
const DECIMAL = /^\d+(?:[.,]\d+)?$/u;

function isEventList(value: unknown): value is EventView[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        typeof item === 'object' &&
        item !== null &&
        typeof (item as Record<string, unknown>).id === 'string' &&
        typeof (item as Record<string, unknown>).kind === 'string',
    )
  );
}

function localNow(): string {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);
}

function formatCivilDate(value: string): string {
  const [year = '', month = '', day = ''] = value.split('-');
  return `${day}/${month}/${year}`;
}

function formatAmount(event: EventView): string {
  return `${event.currencyCode} ${event.amount.replace('.', ',')}`;
}

function accountEffectText(event: EventView): string {
  if (event.transactionId === null) {
    if (event.kind === 'contribution') return 'Posição já existente, sem conta';
    if (movementKinds.has(event.kind) || accountlessKinds.has(event.kind))
      return 'Sem efeito em conta';
    return 'Renda reinvestida';
  }
  if (event.kind === 'contribution') return 'Saiu da conta';
  if (event.kind === 'redemption') return 'Entrou na conta';
  return 'Receita na conta';
}

const rejectionMessages: Readonly<Record<number, string>> = {
  400: 'Confira o valor, a quantidade e a conta informados.',
  404: 'Investimento não encontrado. Atualize a página.',
  409: 'O registro mudou em outra aba. Atualize a página e tente novamente.',
  422: 'Não foi possível registrar: confira se a conta está ativa, se a moeda é a mesma e se o resgate não passa da quantidade em custódia.',
};

/**
 * Declared events of one investment (US-055). Recording an aporte or a
 * resgate only notes what the holder already did elsewhere.
 */
export function InvestmentEvents({
  investment,
}: Readonly<{ investment: Investment }>): ReactNode {
  const [events, setEvents] = useState<readonly EventView[] | null>(null);
  const [accounts, setAccounts] = useState<readonly AccountWithBalance[]>([]);
  const [kind, setKind] = useState<EventKind>('contribution');
  const [amount, setAmount] = useState('');
  const [quantity, setQuantity] = useState('');
  const [unitPrice, setUnitPrice] = useState('');
  const [occurredAt, setOccurredAt] = useState(localNow);
  const [accountId, setAccountId] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const keyRef = useRef(crypto.randomUUID());
  const active = investment.lifecycle === 'active';
  const needsQuantity =
    movementKinds.has(kind) && investment.quantityScale !== null;
  const allowsAccount = !accountlessKinds.has(kind);

  const load = useCallback(async (): Promise<void> => {
    try {
      const response = await fetch(`/api/investments/${investment.id}/events`, {
        cache: 'no-store',
      });
      const data: unknown = response.ok ? await response.json() : null;
      setEvents(isEventList(data) ? data : []);
      if (!response.ok) setError('Movimentações indisponíveis no momento.');
    } catch {
      setError('Movimentações indisponíveis no momento.');
    }
  }, [investment.id]);

  useEffect(() => {
    void load();
    void (async (): Promise<void> => {
      try {
        const response = await fetch('/api/accounts?lifecycle=active', {
          cache: 'no-store',
        });
        if (response.ok)
          setAccounts((await response.json()) as AccountWithBalance[]);
      } catch {
        setAccounts([]);
      }
    })();
  }, [load]);

  const eligibleAccounts = accounts.filter(
    ({ account }) => account.currencyCode === investment.currencyCode,
  );

  function buildBody(): EventBody | string {
    if (!DECIMAL.test(amount.trim())) return 'Informe o valor do evento.';
    if (needsQuantity && !DECIMAL.test(quantity.trim()))
      return 'Informe a quantidade do aporte ou do resgate.';
    if (needsQuantity && unitPrice.trim() !== '' && !DECIMAL.test(unitPrice))
      return 'Informe o preço unitário como número.';
    const instant = new Date(occurredAt);
    if (Number.isNaN(instant.getTime())) return 'Informe a data do evento.';
    return {
      accountId: allowsAccount && accountId !== '' ? accountId : null,
      amount: amount.trim().replace(',', '.'),
      kind,
      note: note.trim() === '' ? null : note.trim(),
      occurredAt: instant.toISOString(),
      quantity: needsQuantity ? quantity.trim().replace(',', '.') : null,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      unitPrice:
        needsQuantity && unitPrice.trim() !== ''
          ? unitPrice.trim().replace(',', '.')
          : null,
    };
  }

  async function record(event: SyntheticEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (busy) return;
    const body = buildBody();
    if (typeof body === 'string') {
      setError(body);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/investments/${investment.id}/events`, {
        body: JSON.stringify(body),
        cache: 'no-store',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': keyRef.current,
        },
        method: 'POST',
      });
      if (!response.ok) {
        setError(
          rejectionMessages[response.status] ??
            'Não foi possível registrar o evento.',
        );
        return;
      }
      keyRef.current = crypto.randomUUID();
      setStatus(`${eventKindLabels[kind]} registrado em ${investment.name}`);
      setAmount('');
      setQuantity('');
      setUnitPrice('');
      setNote('');
      await load();
    } catch {
      setError('Não foi possível registrar o evento.');
    } finally {
      setBusy(false);
    }
  }

  async function change(
    item: EventView,
    action: 'trash' | 'restore',
  ): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/investment-events/${item.id}/lifecycle`,
        {
          body: JSON.stringify({ action, expectedVersion: item.version }),
          headers: { 'Content-Type': 'application/json' },
          method: 'POST',
        },
      );
      if (!response.ok) {
        setError(
          response.status === 422
            ? 'Não foi possível: a quantidade em custódia ficaria negativa ou o investimento não está ativo.'
            : 'Não foi possível alterar o evento. Atualize a página e tente novamente.',
        );
      } else {
        setStatus(
          action === 'trash'
            ? `${eventKindLabels[item.kind]} movido para a lixeira`
            : `${eventKindLabels[item.kind]} restaurado`,
        );
      }
      await load();
    } catch {
      setError('Não foi possível alterar o evento.');
    } finally {
      setBusy(false);
    }
  }

  const prefix = `event-${investment.id}`;
  return (
    <section aria-label={`Movimentações de ${investment.name}`}>
      <h3>Movimentações</h3>
      {error !== null && (
        <p className="form-message error" role="alert">
          {error}
        </p>
      )}
      {status !== null && <p role="status">{status}</p>}
      {active && (
        <form
          aria-label={`Registrar evento em ${investment.name}`}
          className="account-form"
          noValidate
          onSubmit={(submitted) => void record(submitted)}
        >
          <label htmlFor={`${prefix}-kind`}>Tipo de evento</label>
          <select
            id={`${prefix}-kind`}
            onChange={(changed) => {
              setKind(changed.target.value as EventKind);
            }}
            value={kind}
          >
            {Object.entries(eventKindLabels).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
          <label htmlFor={`${prefix}-amount`}>
            Valor ({investment.currencyCode})
          </label>
          <input
            id={`${prefix}-amount`}
            inputMode="decimal"
            onChange={(changed) => {
              setAmount(changed.target.value);
            }}
            value={amount}
          />
          {needsQuantity && (
            <>
              <label htmlFor={`${prefix}-quantity`}>Quantidade</label>
              <input
                id={`${prefix}-quantity`}
                inputMode="decimal"
                onChange={(changed) => {
                  setQuantity(changed.target.value);
                }}
                value={quantity}
              />
              <label htmlFor={`${prefix}-price`}>
                Preço unitário (opcional)
              </label>
              <input
                id={`${prefix}-price`}
                inputMode="decimal"
                onChange={(changed) => {
                  setUnitPrice(changed.target.value);
                }}
                value={unitPrice}
              />
            </>
          )}
          <label htmlFor={`${prefix}-date`}>Data</label>
          <input
            id={`${prefix}-date`}
            onChange={(changed) => {
              setOccurredAt(changed.target.value);
            }}
            type="datetime-local"
            value={occurredAt}
          />
          {allowsAccount && (
            <>
              <label htmlFor={`${prefix}-account`}>Conta (opcional)</label>
              <select
                id={`${prefix}-account`}
                onChange={(changed) => {
                  setAccountId(changed.target.value);
                }}
                value={accountId}
              >
                <option value="">
                  {kind === 'contribution'
                    ? 'Sem conta: posição já existente'
                    : movementKinds.has(kind)
                      ? 'Sem conta'
                      : 'Sem conta: renda reinvestida'}
                </option>
                {eligibleAccounts.map(({ account }) => (
                  <option key={account.id} value={account.id}>
                    {account.name}
                  </option>
                ))}
              </select>
            </>
          )}
          <label htmlFor={`${prefix}-note`}>Observação (opcional)</label>
          <input
            id={`${prefix}-note`}
            maxLength={500}
            onChange={(changed) => {
              setNote(changed.target.value);
            }}
            value={note}
          />
          <p className="account-note">
            Aporte e resgate com conta mudam o saldo da conta, mas não contam
            como receita nem despesa. A Seshat Finance só registra: nada é
            executado na instituição.
          </p>
          <div className="account-actions">
            <button disabled={busy} type="submit">
              Registrar evento
            </button>
          </div>
        </form>
      )}
      {events === null && <p>Carregando movimentações…</p>}
      {events !== null && events.length === 0 && (
        <p>Nenhuma movimentação registrada.</p>
      )}
      {events !== null && events.length > 0 && (
        <ul aria-label={`Eventos de ${investment.name}`}>
          {events.map((item) => (
            <li key={item.id}>
              <p>
                {eventKindLabels[item.kind]} ·{' '}
                {formatCivilDate(item.occurredOn)} · {formatAmount(item)}
                {item.quantity !== null &&
                  ` · ${item.quantity.replace('.', ',')} un.`}
                {' · '}
                {accountEffectText(item)}
                {item.lifecycle === 'trashed' && ' · Na lixeira'}
              </p>
              {active && (
                <button
                  disabled={busy}
                  onClick={() =>
                    void change(
                      item,
                      item.lifecycle === 'trashed' ? 'restore' : 'trash',
                    )
                  }
                  type="button"
                >
                  {item.lifecycle === 'trashed'
                    ? `Restaurar ${eventKindLabels[item.kind].toLowerCase()}`
                    : `Mover ${eventKindLabels[item.kind].toLowerCase()} para a lixeira`}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
