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
  formatMoney,
  isCivilDate,
  isTemporalView,
  shiftDate,
  type Period,
  type TemporalView,
} from './temporal-contract';

type State = 'loading' | 'ready' | 'unauthorized' | 'forbidden' | 'unavailable';
const periods: readonly { value: Period; label: string }[] = [
  { value: 'day', label: 'Dia' },
  { value: 'week', label: 'Semana' },
  { value: 'month', label: 'Mês' },
];

function dateLabel(date: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'full',
    timeZone: 'UTC',
  }).format(new Date(`${date}T12:00:00Z`));
}

function timeLabel(instant: string, timeZone: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone,
  }).format(new Date(instant));
}

export function TemporalJournal(): ReactNode {
  const [period, setPeriod] = useState<Period>('day');
  const [date, setDate] = useState('');
  const [state, setState] = useState<State>('loading');
  const [view, setView] = useState<TemporalView | null>(null);
  const statusRef = useRef<HTMLParagraphElement>(null);
  const requestRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    async function initialize(): Promise<void> {
      try {
        const response = await fetch('/api/users/me/profile', {
          cache: 'no-store',
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
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
        const profile: unknown = await response.json();
        if (
          typeof profile !== 'object' ||
          profile === null ||
          !('timeZone' in profile) ||
          typeof profile.timeZone !== 'string'
        ) {
          setState('unavailable');
          return;
        }
        const parts = new Intl.DateTimeFormat('en-CA', {
          timeZone: profile.timeZone,
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        }).formatToParts(new Date());
        const value = (type: string): string =>
          parts.find((part) => part.type === type)?.value ?? '';
        setDate(`${value('year')}-${value('month')}-${value('day')}`);
      } catch {
        if (!controller.signal.aborted) setState('unavailable');
      }
    }
    void initialize();
    return () => {
      controller.abort();
    };
  }, []);

  const load = useCallback(
    async (nextPeriod: Period, nextDate: string): Promise<void> => {
      if (!isCivilDate(nextDate)) return;
      requestRef.current?.abort();
      const controller = new AbortController();
      requestRef.current = controller;
      setState('loading');
      setView(null);
      try {
        const query = new URLSearchParams({
          period: nextPeriod,
          date: nextDate,
        });
        const response = await fetch(`/api/transactions/temporal?${query}`, {
          cache: 'no-store',
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
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
        if (requestRef.current !== controller) return;
        if (!isTemporalView(data)) {
          setState('unavailable');
          return;
        }
        setView(data);
        setState('ready');
      } catch {
        if (!controller.signal.aborted) setState('unavailable');
      }
    },
    [],
  );

  useEffect(() => {
    if (date !== '') {
      void load(period, date);
    }
    return () => {
      requestRef.current?.abort();
    };
  }, [date, period, load]);
  useEffect(() => {
    if (
      state === 'unauthorized' ||
      state === 'forbidden' ||
      state === 'unavailable'
    )
      statusRef.current?.focus();
  }, [state]);

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
      </header>
      <main
        className="accounts-page temporal-page"
        id="main-content"
        tabIndex={-1}
      >
        <div className="accounts-heading">
          <span className="section-label">Seus registros</span>
          <h1>Movimentações</h1>
          <p>Consulte seus registros por dia, semana ou mês.</p>
        </div>
        <div className="account-filters" role="group" aria-label="Período">
          {periods.map((option) => (
            <button
              type="button"
              key={option.value}
              className={period === option.value ? 'selected' : ''}
              aria-pressed={period === option.value}
              onClick={() => {
                setPeriod(option.value);
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
        <div className="temporal-navigation">
          <button
            type="button"
            onClick={() => {
              setDate(shiftDate(date, period, -1));
            }}
            disabled={!isCivilDate(date)}
            aria-label="Período anterior"
          >
            Anterior
          </button>
          <label htmlFor="temporal-date">
            {period === 'day'
              ? 'Selecionar dia'
              : period === 'week'
                ? 'Selecionar semana por data'
                : 'Selecionar mês por data'}
          </label>
          <input
            id="temporal-date"
            type="date"
            value={date}
            onChange={(event) => {
              if (isCivilDate(event.target.value)) setDate(event.target.value);
            }}
          />
          <button
            type="button"
            onClick={() => {
              setDate(shiftDate(date, period, 1));
            }}
            disabled={!isCivilDate(date)}
            aria-label="Próximo período"
          >
            Próximo
          </button>
        </div>
        {state === 'loading' && <p role="status">Carregando movimentações…</p>}
        {state === 'unauthorized' && (
          <p role="alert" tabIndex={-1} ref={statusRef}>
            Sua sessão expirou. <Link href="/entrar">Entre novamente</Link> para
            consultar suas movimentações.
          </p>
        )}
        {state === 'forbidden' && (
          <p role="alert" tabIndex={-1} ref={statusRef}>
            Você não tem acesso a estas movimentações.
          </p>
        )}
        {state === 'unavailable' && (
          <p role="alert" tabIndex={-1} ref={statusRef}>
            Não foi possível carregar as movimentações.{' '}
            {isCivilDate(date) && (
              <button
                type="button"
                onClick={() => {
                  void load(period, date);
                }}
              >
                Tentar novamente
              </button>
            )}
          </p>
        )}
        {state === 'ready' && view !== null && (
          <>
            <p className="account-note">
              Datas e horários no fuso {view.timeZone}.
            </p>
            <section aria-label="Totais do período" className="temporal-totals">
              <h2>Totais do período</h2>
              {view.totals.length === 0 ? (
                <p>Sem valores neste período.</p>
              ) : (
                <ul>
                  {view.totals.map((total) => (
                    <li key={total.currencyCode}>
                      <strong>{total.currencyCode}</strong>
                      <span>
                        Receitas:{' '}
                        {formatMoney(
                          total.income,
                          total.currencyCode,
                          total.currencyMinorUnitScale,
                        )}
                      </span>
                      <span>
                        Despesas:{' '}
                        {formatMoney(
                          total.expense,
                          total.currencyCode,
                          total.currencyMinorUnitScale,
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            {view.days.every((day) => day.transactions.length === 0) ? (
              <p role="status">Nenhuma movimentação neste período.</p>
            ) : (
              <div className="temporal-days">
                {view.days
                  .filter((day) => day.transactions.length > 0)
                  .map((day) => (
                    <section key={day.date} aria-label={dateLabel(day.date)}>
                      <h2>{dateLabel(day.date)}</h2>
                      <ol>
                        {day.transactions.map((transaction) => (
                          <li key={transaction.id}>
                            <span>
                              {timeLabel(transaction.occurredAt, view.timeZone)}
                            </span>
                            <span>
                              {transaction.description?.trim() ??
                                (transaction.kind === 'income'
                                  ? 'Receita'
                                  : 'Despesa')}
                            </span>
                            <strong>
                              {transaction.kind === 'income' ? '+' : '−'}{' '}
                              {formatMoney(
                                transaction.amount,
                                transaction.currencyCode,
                                transaction.currencyMinorUnitScale,
                              )}
                            </strong>
                          </li>
                        ))}
                      </ol>
                    </section>
                  ))}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
