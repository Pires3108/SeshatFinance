'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type SyntheticEvent,
} from 'react';

import { formatMoney, parseDecimalInput } from '../../metas/goal-presentation';

type MoneyView = Readonly<{ amount: string; currencyCode: string }>;

export type AccountAvailability = Readonly<{
  accountId: string;
  book: MoneyView;
  reserved: MoneyView;
  available: MoneyView;
  reserveAboveBalance: boolean;
  reserveVersion: number;
}>;

function isMoney(value: unknown): value is MoneyView {
  if (typeof value !== 'object' || value === null) return false;
  const money = value as Record<string, unknown>;
  return (
    typeof money.amount === 'string' &&
    /^-?\d+(?:\.\d+)?$/u.test(money.amount) &&
    typeof money.currencyCode === 'string'
  );
}

export function isAccountAvailability(
  value: unknown,
): value is AccountAvailability {
  if (typeof value !== 'object' || value === null) return false;
  const view = value as Record<string, unknown>;
  return (
    typeof view.accountId === 'string' &&
    isMoney(view.book) &&
    isMoney(view.reserved) &&
    isMoney(view.available) &&
    typeof view.reserveAboveBalance === 'boolean' &&
    typeof view.reserveVersion === 'number'
  );
}

/** Decimal string to minor units at the scale of `like` (no floating point). */
function minorUnits(amount: string, scale: number): bigint | null {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/u.exec(amount);
  if (match === null) return null;
  const [, sign = '', whole = '0', fraction = ''] = match;
  if (fraction.length > scale) return null;
  const units = BigInt(whole + fraction.padEnd(scale, '0'));
  return sign === '-' ? -units : units;
}

function scaleOf(money: MoneyView): number {
  return money.amount.split('.')[1]?.length ?? 0;
}

function fromMinorUnits(units: bigint, scale: number): string {
  const negative = units < 0n;
  const digits = (negative ? -units : units)
    .toString()
    .padStart(scale + 1, '0');
  const whole = digits.slice(0, digits.length - scale);
  const fraction = digits.slice(digits.length - scale);
  return `${negative ? '-' : ''}${whole}${scale > 0 ? `.${fraction}` : ''}`;
}

/**
 * Reserve of an account (US-051, RN-071). A reserve only labels part of the
 * balance: the book balance and the net worth stay the same, and nothing is
 * moved. The panel explains the effect before the holder confirms.
 */
export function ReservePanel({
  accountId,
  editable,
}: Readonly<{ accountId: string; editable: boolean }>): ReactNode {
  const [view, setView] = useState<AccountAvailability | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [input, setInput] = useState('');
  const [pending, setPending] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const keyRef = useRef<string>(crypto.randomUUID());

  const load = useCallback(async (): Promise<void> => {
    try {
      const response = await fetch(
        `/api/accounts/${encodeURIComponent(accountId)}/reserve`,
        { cache: 'no-store' },
      );
      const data: unknown = response.ok ? await response.json() : null;
      if (!isAccountAvailability(data)) {
        setLoadFailed(true);
        return;
      }
      setLoadFailed(false);
      setView(data);
    } catch {
      setLoadFailed(true);
    }
  }, [accountId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loadFailed) {
    return (
      <section aria-labelledby="reserve-title" className="reserve-panel">
        <h2 id="reserve-title">Reserva</h2>
        <p role="alert">
          Não foi possível carregar a reserva.{' '}
          <button onClick={() => void load()} type="button">
            Tentar novamente
          </button>
        </p>
      </section>
    );
  }
  if (view === null) {
    return <p role="status">Carregando reserva…</p>;
  }

  const scale = scaleOf(view.book);
  const book = minorUnits(view.book.amount, scale) ?? 0n;
  const reserved = minorUnits(view.reserved.amount, scale) ?? 0n;
  const pendingUnits = pending === null ? null : minorUnits(pending, scale);
  const money = (units: bigint): MoneyView => ({
    amount: fromMinorUnits(units, scale),
    currencyCode: view.book.currencyCode,
  });

  function prepare(event: SyntheticEvent<HTMLFormElement>): void {
    event.preventDefault();
    setMessage('');
    const decimal = parseDecimalInput(input);
    const units = decimal === null ? null : minorUnits(decimal, scale);
    if (decimal === null || units === null) {
      setError(
        `Informe um valor válido em ${view?.book.currencyCode ?? ''}, com até ${String(scale)} casas decimais.`,
      );
      return;
    }
    if (units > reserved && units > book) {
      setError(
        'A reserva não pode ser maior que o saldo contábil atual. Nada foi alterado.',
      );
      return;
    }
    setError('');
    setPending(decimal);
  }

  async function confirm(amount: string): Promise<void> {
    if (view === null) return;
    setBusy(true);
    setError('');
    try {
      const response = await fetch(
        `/api/accounts/${encodeURIComponent(accountId)}/reserve`,
        {
          body: JSON.stringify({
            amount,
            expectedVersion: view.reserveVersion,
          }),
          headers: {
            'Content-Type': 'application/json',
            'Idempotency-Key': keyRef.current,
          },
          method: 'PUT',
        },
      );
      const data: unknown = response.ok ? await response.json() : null;
      if (response.ok && isAccountAvailability(data)) {
        keyRef.current = crypto.randomUUID();
        setView(data);
        setPending(null);
        setInput('');
        setMessage(
          data.reserved.amount === fromMinorUnits(0n, scale)
            ? 'Reserva removida. O saldo contábil não mudou.'
            : 'Reserva salva. O saldo contábil não mudou.',
        );
        return;
      }
      keyRef.current = crypto.randomUUID();
      setPending(null);
      if (response.status === 422) {
        setError(
          'A reserva não pode ser maior que o saldo contábil atual. Nada foi alterado.',
        );
      } else if (response.status === 409) {
        setError(
          'A reserva foi alterada em outra tela. Os valores foram atualizados; revise e tente de novo.',
        );
        await load();
      } else {
        setError('Não foi possível salvar a reserva. Tente novamente.');
      }
    } catch {
      setError('Não foi possível salvar a reserva. Tente novamente.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="reserve-title" className="reserve-panel">
      <h2 id="reserve-title">Reserva</h2>
      <dl>
        <div>
          <dt>Saldo contábil</dt>
          <dd data-testid="reserve-book">{formatMoney(view.book)}</dd>
        </div>
        <div>
          <dt>Reserva</dt>
          <dd data-testid="reserve-reserved">{formatMoney(view.reserved)}</dd>
        </div>
        <div>
          <dt>Disponível</dt>
          <dd data-testid="reserve-available">{formatMoney(view.available)}</dd>
        </div>
      </dl>
      {view.reserveAboveBalance && (
        <p className="form-message warning" role="status">
          Atenção: reserva acima do saldo. O saldo caiu depois da reserva; a
          reserva foi mantida e o disponível ficou negativo.
        </p>
      )}
      <p className="account-note">
        Disponível = saldo contábil − reserva. Reservar não move dinheiro, não
        cria lançamento e não muda o patrimônio, que conta o saldo contábil uma
        única vez.
      </p>
      {error !== '' && (
        <p className="form-message error" role="alert">
          {error}
        </p>
      )}
      {message !== '' && (
        <p className="form-message success" role="status">
          {message}
        </p>
      )}
      {editable && pending === null && (
        <form className="reserve-form" noValidate onSubmit={prepare}>
          <label htmlFor="reserve-amount">
            Novo valor da reserva ({view.book.currencyCode})
          </label>
          <input
            id="reserve-amount"
            inputMode="decimal"
            onChange={(event) => {
              setInput(event.target.value);
            }}
            value={input}
          />
          <button disabled={busy} type="submit">
            Revisar reserva
          </button>
          {reserved > 0n && (
            <button
              disabled={busy}
              onClick={() => {
                setError('');
                setMessage('');
                setPending(fromMinorUnits(0n, scale));
              }}
              type="button"
            >
              Remover reserva
            </button>
          )}
        </form>
      )}
      {editable && pending !== null && pendingUnits !== null && (
        <div aria-live="polite" className="reserve-preview" role="group">
          <p>
            {pendingUnits === 0n
              ? 'Remover a reserva'
              : `Reservar ${formatMoney(money(pendingUnits))}`}
            : o disponível passa de {formatMoney(view.available)} para{' '}
            {formatMoney(money(book - pendingUnits))}. O saldo contábil continua{' '}
            {formatMoney(view.book)} e o patrimônio não muda.
          </p>
          <button
            disabled={busy}
            onClick={() => void confirm(pending)}
            type="button"
          >
            Confirmar reserva
          </button>
          <button
            disabled={busy}
            onClick={() => {
              setPending(null);
            }}
            type="button"
          >
            Cancelar
          </button>
        </div>
      )}
      {!editable && (
        <p className="account-note">
          Só uma conta ativa aceita mudança de reserva.
        </p>
      )}
    </section>
  );
}
