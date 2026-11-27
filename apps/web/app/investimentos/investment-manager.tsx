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

import { InvestmentEvents } from './investment-events';

type InvestmentView =
  paths['/api/v1/investments']['get']['responses'][200]['content']['application/json'][number];
type CreateBody = NonNullable<
  paths['/api/v1/investments']['post']['requestBody']
>['content']['application/json'];
type InvestmentTypeKey = InvestmentView['type'];
type Indexer = NonNullable<InvestmentView['contractedRate']>['indexer'];
type LiquidityKind = InvestmentView['liquidity']['kind'];
type LifecycleAction = 'archive' | 'unarchive' | 'trash' | 'restore';
type LoadState = 'loading' | 'ready' | 'unauthorized' | 'unavailable';
type Message = Readonly<{ kind: 'error' | 'status'; text: string }>;

export const investmentTypeLabels: Readonly<Record<InvestmentTypeKey, string>> =
  {
    cdb: 'CDB',
    cryptocurrency: 'Criptomoeda',
    etf: 'ETF',
    fii: 'FII',
    'investment-fund': 'Fundo de investimento',
    lca: 'LCA',
    lci: 'LCI',
    'private-pension': 'Previdência privada',
    savings: 'Poupança',
    stock: 'Ação',
    'treasury-direct': 'Tesouro Direto',
  };

const indexerLabels: Readonly<Record<Indexer, string>> = {
  cdi: '% do CDI',
  ipca: 'IPCA +',
  other: 'Outro',
  prefixed: 'Prefixado',
  selic: '% da Selic',
};

const lifecycleLabels: Readonly<Record<InvestmentView['lifecycle'], string>> = {
  active: 'Ativo',
  archived: 'Arquivado',
  trashed: 'Na lixeira',
};

const currencies = ['BRL', 'USD', 'EUR'] as const;
const DECIMAL = /^\d+(?:[.,]\d+)?$/u;

function isInvestmentList(value: unknown): value is InvestmentView[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        typeof item === 'object' &&
        item !== null &&
        typeof (item as Record<string, unknown>).id === 'string' &&
        typeof (item as Record<string, unknown>).type === 'string',
    )
  );
}

function formatCivilDate(value: string): string {
  const [year = '', month = '', day = ''] = value.split('-');
  return `${day}/${month}/${year}`;
}

function liquidityText(liquidity: InvestmentView['liquidity']): string {
  if (liquidity.kind === 'daily') return 'Liquidez diária';
  if (liquidity.kind === 'at-maturity') return 'Liquidez no vencimento';
  return `Liquidez em D+${String(liquidity.days ?? 0)}`;
}

function rateText(rate: InvestmentView['contractedRate']): string | null {
  if (rate === null) return null;
  const percent = rate.percent.replace('.', ',');
  switch (rate.indexer) {
    case 'cdi':
    case 'selic':
      return `${percent}${indexerLabels[rate.indexer]}`;
    case 'ipca':
      return `IPCA + ${percent}%`;
    case 'prefixed':
      return `${percent}% prefixado`;
    case 'other':
      return `${percent}% (outro indexador)`;
  }
}

function lifecycleActions(
  lifecycle: InvestmentView['lifecycle'],
): readonly Readonly<{ action: LifecycleAction; label: string }>[] {
  switch (lifecycle) {
    case 'active':
      return [
        { action: 'archive', label: 'Arquivar' },
        { action: 'trash', label: 'Mover para a lixeira' },
      ];
    case 'archived':
      return [
        { action: 'unarchive', label: 'Desarquivar' },
        { action: 'trash', label: 'Mover para a lixeira' },
      ];
    case 'trashed':
      return [{ action: 'restore', label: 'Restaurar' }];
  }
}

const doneMessages: Readonly<Record<LifecycleAction, string>> = {
  archive: 'Investimento arquivado',
  restore: 'Investimento restaurado',
  trash: 'Investimento movido para a lixeira',
  unarchive: 'Investimento desarquivado',
};

/**
 * Manual investments (US-054). The page only records what the holder
 * declares: nothing is bought, sold or moved at any institution.
 */
export function InvestmentManager(): ReactNode {
  const [state, setState] = useState<LoadState>('loading');
  const [investments, setInvestments] = useState<readonly InvestmentView[]>([]);
  const [creating, setCreating] = useState(false);
  const [type, setType] = useState<InvestmentTypeKey>('cdb');
  const [institution, setInstitution] = useState('');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [currency, setCurrency] = useState<(typeof currencies)[number]>('BRL');
  const [startDate, setStartDate] = useState('');
  const [maturityDate, setMaturityDate] = useState('');
  const [indexer, setIndexer] = useState<Indexer | ''>('');
  const [percent, setPercent] = useState('');
  const [liquidityKind, setLiquidityKind] = useState<LiquidityKind>('daily');
  const [liquidityDays, setLiquidityDays] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);
  const [openEventsId, setOpenEventsId] = useState<string | null>(null);
  const keyRef = useRef<string>(crypto.randomUUID());

  const load = useCallback(async (): Promise<void> => {
    try {
      const response = await fetch('/api/investments', { cache: 'no-store' });
      if (response.status === 401) {
        setState('unauthorized');
        return;
      }
      const data: unknown = response.ok ? await response.json() : null;
      if (!isInvestmentList(data)) {
        setState('unavailable');
        return;
      }
      setInvestments(data);
      setState('ready');
    } catch {
      setState('unavailable');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function resetForm(): void {
    setInstitution('');
    setName('');
    setCode('');
    setStartDate('');
    setMaturityDate('');
    setIndexer('');
    setPercent('');
    setLiquidityKind('daily');
    setLiquidityDays('');
  }

  function buildBody(): CreateBody | string {
    if (institution.trim() === '' || name.trim() === '') {
      return 'Informe a instituição e o nome do ativo.';
    }
    if (!/^\d{4}-\d{2}-\d{2}$/u.test(startDate)) {
      return 'Informe a data inicial.';
    }
    if (maturityDate !== '' && maturityDate < startDate) {
      return 'O vencimento não pode ser anterior à data inicial.';
    }
    if (liquidityKind === 'at-maturity' && maturityDate === '') {
      return 'Liquidez no vencimento exige a data de vencimento.';
    }
    if (indexer !== '' && !DECIMAL.test(percent.trim())) {
      return 'Informe a taxa contratada como número, por exemplo 110 ou 6,5.';
    }
    const days = Number.parseInt(liquidityDays, 10);
    if (
      liquidityKind === 'd-plus' &&
      (!/^\d{1,4}$/u.test(liquidityDays) || days > 3650)
    ) {
      return 'Informe os dias de liquidez entre 0 e 3650.';
    }
    return {
      code: code.trim() === '' ? null : code.trim(),
      contractedRate:
        indexer === ''
          ? null
          : { indexer, percent: percent.trim().replace(',', '.') },
      currencyCode: currency,
      currencyMinorUnitScale: 2,
      institution: institution.trim(),
      liquidity:
        liquidityKind === 'd-plus'
          ? { days, kind: 'd-plus' }
          : { kind: liquidityKind },
      maturityDate: maturityDate === '' ? null : maturityDate,
      name: name.trim(),
      startDate,
      type,
    };
  }

  async function create(event: SyntheticEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const body = buildBody();
    if (typeof body === 'string') {
      setMessage({ kind: 'error', text: body });
      return;
    }
    setBusy(true);
    try {
      const response = await fetch('/api/investments', {
        body: JSON.stringify(body),
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': keyRef.current,
        },
        method: 'POST',
      });
      if (!response.ok) {
        setMessage({
          kind: 'error',
          text: 'Não foi possível registrar o investimento. Confira os dados e tente novamente.',
        });
        return;
      }
      keyRef.current = crypto.randomUUID();
      setMessage({
        kind: 'status',
        text: `Investimento registrado: ${body.name}`,
      });
      setCreating(false);
      resetForm();
      await load();
    } catch {
      setMessage({
        kind: 'error',
        text: 'Não foi possível registrar o investimento.',
      });
    } finally {
      setBusy(false);
    }
  }

  async function change(
    investment: InvestmentView,
    action: LifecycleAction,
  ): Promise<void> {
    setBusy(true);
    try {
      const response = await fetch(
        `/api/investments/${investment.id}/lifecycle`,
        {
          body: JSON.stringify({
            action,
            expectedVersion: investment.version,
          }),
          headers: { 'Content-Type': 'application/json' },
          method: 'POST',
        },
      );
      setMessage(
        response.ok
          ? {
              kind: 'status',
              text: `${doneMessages[action]}: ${investment.name}`,
            }
          : {
              kind: 'error',
              text: 'Não foi possível alterar o investimento. Atualize a página e tente novamente.',
            },
      );
      await load();
    } catch {
      setMessage({
        kind: 'error',
        text: 'Não foi possível alterar o investimento.',
      });
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
            <span className="section-label">Patrimônio</span>
            <h1>Investimentos</h1>
            <p>
              Registre seus investimentos manualmente. A Seshat Finance só anota
              o que você informa: nada é comprado, vendido ou movido na
              instituição.
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
              Registrar investimento
            </button>
          )}
        </div>
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
            aria-label="Registrar investimento"
            className="account-form"
            noValidate
            onSubmit={(event) => void create(event)}
          >
            <label htmlFor="investment-type">Tipo</label>
            <select
              id="investment-type"
              onChange={(event) => {
                setType(event.target.value as InvestmentTypeKey);
              }}
              value={type}
            >
              {Object.entries(investmentTypeLabels).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
            <label htmlFor="investment-institution">Instituição</label>
            <input
              id="investment-institution"
              maxLength={120}
              onChange={(event) => {
                setInstitution(event.target.value);
              }}
              value={institution}
            />
            <label htmlFor="investment-name">Ativo</label>
            <input
              id="investment-name"
              maxLength={120}
              onChange={(event) => {
                setName(event.target.value);
              }}
              value={name}
            />
            <label htmlFor="investment-code">Código (opcional)</label>
            <input
              id="investment-code"
              maxLength={20}
              onChange={(event) => {
                setCode(event.target.value);
              }}
              value={code}
            />
            <label htmlFor="investment-currency">Moeda</label>
            <select
              id="investment-currency"
              onChange={(event) => {
                setCurrency(event.target.value as (typeof currencies)[number]);
              }}
              value={currency}
            >
              {currencies.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
            <label htmlFor="investment-start">Data inicial</label>
            <input
              id="investment-start"
              onChange={(event) => {
                setStartDate(event.target.value);
              }}
              type="date"
              value={startDate}
            />
            <label htmlFor="investment-maturity">Vencimento (opcional)</label>
            <input
              id="investment-maturity"
              onChange={(event) => {
                setMaturityDate(event.target.value);
              }}
              type="date"
              value={maturityDate}
            />
            <label htmlFor="investment-indexer">
              Indexador da taxa contratada (opcional)
            </label>
            <select
              id="investment-indexer"
              onChange={(event) => {
                setIndexer(event.target.value as Indexer | '');
              }}
              value={indexer}
            >
              <option value="">Sem taxa contratada</option>
              {Object.entries(indexerLabels).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
            {indexer !== '' && (
              <>
                <label htmlFor="investment-rate">Taxa contratada (%)</label>
                <input
                  id="investment-rate"
                  inputMode="decimal"
                  onChange={(event) => {
                    setPercent(event.target.value);
                  }}
                  value={percent}
                />
              </>
            )}
            <p className="account-note">
              A taxa contratada é só informativa e não entra no cálculo de
              custo, valor ou rentabilidade.
            </p>
            <label htmlFor="investment-liquidity">Liquidez</label>
            <select
              id="investment-liquidity"
              onChange={(event) => {
                setLiquidityKind(event.target.value as LiquidityKind);
              }}
              value={liquidityKind}
            >
              <option value="daily">Diária</option>
              <option value="at-maturity">No vencimento</option>
              <option value="d-plus">Em dias úteis (D+N)</option>
            </select>
            {liquidityKind === 'd-plus' && (
              <>
                <label htmlFor="investment-liquidity-days">
                  Dias úteis para resgate
                </label>
                <input
                  id="investment-liquidity-days"
                  inputMode="numeric"
                  onChange={(event) => {
                    setLiquidityDays(event.target.value);
                  }}
                  value={liquidityDays}
                />
              </>
            )}
            <div className="account-actions">
              <button disabled={busy} type="submit">
                Salvar investimento
              </button>
              <button
                disabled={busy}
                onClick={() => {
                  setCreating(false);
                  resetForm();
                }}
                type="button"
              >
                Cancelar
              </button>
            </div>
          </form>
        )}
        {state === 'loading' && <p>Carregando investimentos…</p>}
        {state === 'unauthorized' && (
          <p role="alert">
            Seu acesso expirou. <Link href="/entrar">Entre novamente</Link> para
            consultar seus investimentos.
          </p>
        )}
        {state === 'unavailable' && (
          <p role="alert">Investimentos indisponíveis no momento.</p>
        )}
        {state === 'ready' && investments.length === 0 && !creating && (
          <p>Nenhum investimento registrado.</p>
        )}
        {state === 'ready' && investments.length > 0 && (
          <ul aria-label="Investimentos" className="loan-list">
            {investments.map((investment) => {
              const rate = rateText(investment.contractedRate);
              return (
                <li key={investment.id}>
                  <h2>
                    {investment.name}
                    {investment.code !== null && ` (${investment.code})`}
                  </h2>
                  <p>
                    {investmentTypeLabels[investment.type]} ·{' '}
                    {investment.institution} · {investment.currencyCode} ·{' '}
                    {lifecycleLabels[investment.lifecycle]}
                  </p>
                  <p>
                    Desde {formatCivilDate(investment.startDate)}
                    {investment.maturityDate !== null &&
                      ` · Vence em ${formatCivilDate(investment.maturityDate)}`}
                    {' · '}
                    {liquidityText(investment.liquidity)}
                  </p>
                  {rate !== null && <p>Taxa contratada: {rate}</p>}
                  <div className="account-actions">
                    {lifecycleActions(investment.lifecycle).map((item) => (
                      <button
                        disabled={busy}
                        key={item.action}
                        onClick={() => void change(investment, item.action)}
                        type="button"
                      >
                        {item.label}
                      </button>
                    ))}
                    {investment.lifecycle !== 'trashed' && (
                      <button
                        aria-expanded={openEventsId === investment.id}
                        onClick={() => {
                          setOpenEventsId(
                            openEventsId === investment.id
                              ? null
                              : investment.id,
                          );
                        }}
                        type="button"
                      >
                        {openEventsId === investment.id
                          ? 'Ocultar movimentações'
                          : 'Movimentações'}
                      </button>
                    )}
                  </div>
                  {openEventsId === investment.id &&
                    investment.lifecycle !== 'trashed' && (
                      <InvestmentEvents investment={investment} />
                    )}
                </li>
              );
            })}
          </ul>
        )}
      </main>
    </div>
  );
}
