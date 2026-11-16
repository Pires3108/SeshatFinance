'use client';

import type { paths } from '@seshat/contracts';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type SyntheticEvent,
} from 'react';

import { formatBalance } from '../accounts/account-presentation';
import { formatCivilDate, type Card } from './card-presentation';

type Chain =
  paths['/api/v1/credit-cards/{cardId}/purchases/{purchaseId}/installment-plan/chain']['get']['responses'][200]['content']['application/json'];
type PlanEntry = Chain['plans'][number];
type Action = 'prepayment' | 'renegotiation' | Readonly<{ reverse: string }>;
type Interest = 'none' | 'simple' | 'compound';

const DECIMAL = /^\d+(?:[.,]\d{1,18})?$/u;
const PERCENT = /^\d{1,3}(?:[.,]\d{1,6})?$/u;

const situationLabels: Record<
  PlanEntry['situations'][number]['situation'],
  string
> = {
  invoiced: 'Na fatura',
  prepaid: 'Antecipada',
  projected: 'Projetada',
  renegotiated: 'Renegociada',
};
const statusLabels: Record<PlanEntry['status'], string> = {
  active: 'Ativo',
  prepaid: 'Antecipado',
  renegotiated: 'Renegociado',
};

function isChain(value: unknown): value is Chain {
  return (
    typeof value === 'object' &&
    value !== null &&
    Array.isArray((value as Record<string, unknown>).plans)
  );
}

/**
 * Plans of a purchase with prepayment, renegotiation and reversal (US-046).
 * Each action declares something already agreed with the issuer.
 */
export function InstallmentPlanActions({
  card,
  purchaseId,
  description,
  onChanged,
}: Readonly<{
  card: Card;
  purchaseId: string;
  description: string;
  onChanged: () => void;
}>): ReactNode {
  const [chain, setChain] = useState<Chain | null>(null);
  const [action, setAction] = useState<Action | null>(null);
  const [amount, setAmount] = useState('');
  const [discount, setDiscount] = useState('0');
  const [count, setCount] = useState('2');
  const [interest, setInterest] = useState<Interest>('none');
  const [percent, setPercent] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Readonly<{
    kind: 'status' | 'error';
    text: string;
  }> | null>(null);
  const keyRef = useRef('');
  const messageRef = useRef<HTMLParagraphElement>(null);
  const base = `/api/cards/${card.id}/purchases/${purchaseId}/installment-plan`;
  const prefix = `plan-${purchaseId}`;

  const load = useCallback(async (): Promise<void> => {
    try {
      const response = await fetch(`${base}/chain`, { cache: 'no-store' });
      const data: unknown = response.ok ? await response.json() : null;
      setChain(isChain(data) ? data : null);
    } catch {
      setChain(null);
    }
  }, [base]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (message !== null) messageRef.current?.focus();
  }, [message]);

  const money = (value: string): string =>
    formatBalance({
      amount: value,
      currencyCode: card.currencyCode,
      currencyMinorUnitScale: card.currencyMinorUnitScale,
    });
  const current = chain?.plans.at(-1);

  function begin(next: Action): void {
    keyRef.current = crypto.randomUUID();
    const outstanding = current?.futureOutstanding ?? '';
    setAmount(outstanding);
    setDiscount('0');
    setCount('2');
    setInterest('none');
    setPercent('');
    setReason('');
    setMessage(null);
    setAction(next);
  }

  function request(): Readonly<{ path: string; body: unknown }> | string {
    if (action === null) return 'Escolha uma ação.';
    if (typeof action === 'object') {
      if (reason.trim() === '') return 'Informe o motivo da reversão.';
      return {
        body: { reason: reason.trim() },
        path: `changes/${action.reverse}/reversal`,
      };
    }
    if (!DECIMAL.test(amount.trim()))
      return 'Informe o valor, por exemplo 60,00.';
    const value = amount.trim().replace(',', '.');
    if (action === 'prepayment') {
      if (!DECIMAL.test(discount.trim())) return 'Informe o desconto, ou 0.';
      return {
        body: { amount: value, discount: discount.trim().replace(',', '.') },
        path: 'prepayment',
      };
    }
    const installments = Number(count);
    if (
      !Number.isInteger(installments) ||
      installments < 1 ||
      installments > 420
    )
      return 'Informe de 1 a 420 parcelas.';
    if (interest !== 'none' && !PERCENT.test(percent.trim()))
      return 'Informe a taxa mensal em porcentagem, por exemplo 1,99.';
    return {
      body: {
        count: installments,
        principal: value,
        rate:
          interest === 'none'
            ? null
            : {
                method: interest,
                percentPerPeriod: percent.trim().replace(',', '.'),
                periodicity: 'monthly',
              },
      },
      path: 'renegotiation',
    };
  }

  async function submit(
    event: SyntheticEvent<HTMLFormElement, SubmitEvent>,
  ): Promise<void> {
    event.preventDefault();
    if (busy) return;
    const next = request();
    if (typeof next === 'string') {
      setMessage({ kind: 'error', text: next });
      return;
    }
    setBusy(true);
    try {
      const response = await fetch(`${base}/${next.path}`, {
        body: JSON.stringify(next.body),
        cache: 'no-store',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': keyRef.current,
        },
        method: 'POST',
      });
      const data: unknown = response.ok ? await response.json() : null;
      if (!isChain(data)) {
        setMessage({
          kind: 'error',
          text:
            response.status === 422
              ? 'Não é possível registrar: confira se valor mais desconto fecha as parcelas futuras e se a fatura atual está aberta.'
              : 'Não foi possível registrar. Tente novamente com os mesmos dados.',
        });
        return;
      }
      setChain(data);
      setAction(null);
      setMessage({ kind: 'status', text: 'Parcelamento atualizado.' });
      onChanged();
    } catch {
      setMessage({
        kind: 'error',
        text: 'Não foi possível registrar. Tente novamente com os mesmos dados.',
      });
    } finally {
      setBusy(false);
    }
  }

  if (chain === null) return <p role="status">Carregando parcelamento…</p>;

  return (
    <section
      aria-label={`Parcelamento de ${description}`}
      className="installment-plan-actions"
    >
      {chain.plans.map((entry, index) => (
        <div key={entry.plan.id}>
          <p>
            {index === 0 ? 'Plano original' : 'Plano renegociado'}:{' '}
            {statusLabels[entry.status]} · total {money(entry.plan.total)} ·
            cálculo versão {entry.plan.calculationVersion}
          </p>
          <ul>
            {entry.situations.map((item) => (
              <li key={item.number}>
                Parcela {item.number}/{entry.plan.count}: {money(item.amount)} ·
                fatura de {formatCivilDate(item.cycleClosesOn)} ·{' '}
                {situationLabels[item.situation]}
              </li>
            ))}
          </ul>
          {entry.changes
            .filter((change) => change.kind === 'prepayment')
            .map((change) => (
              <p key={change.id}>
                Antecipação de {money(change.amount ?? '0')}
                {change.discount !== null &&
                !/^0(?:\.0+)?$/u.test(change.discount)
                  ? ` com desconto de ${money(change.discount)}`
                  : ''}
                {change.reversed ? ' (revertida)' : ''}{' '}
                {!change.reversed && index === chain.plans.length - 1 && (
                  <button
                    onClick={() => {
                      begin({ reverse: change.id });
                    }}
                    type="button"
                  >
                    Reverter antecipação
                  </button>
                )}
              </p>
            ))}
        </div>
      ))}
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
      {current?.status === 'active' && action === null && (
        <div className="account-actions">
          <button
            disabled={current.futureOutstanding === '0.00'}
            onClick={() => {
              begin('prepayment');
            }}
            type="button"
          >
            Antecipar parcelas futuras
          </button>
          <button
            disabled={current.futureOutstanding === '0.00'}
            onClick={() => {
              begin('renegotiation');
            }}
            type="button"
          >
            Registrar renegociação
          </button>
        </div>
      )}
      {action !== null && (
        <form
          aria-label={
            action === 'prepayment'
              ? 'Antecipar parcelas futuras'
              : action === 'renegotiation'
                ? 'Registrar renegociação do parcelamento'
                : 'Reverter antecipação'
          }
          onSubmit={(event) => void submit(event)}
        >
          <p className="field-note">
            Registre o que já foi acordado com o emissor; nada é enviado a ele.
            Parcelas futuras somam {money(current?.futureOutstanding ?? '0')}.
          </p>
          {typeof action === 'object' ? (
            <div className="field">
              <label htmlFor={`${prefix}-reason`}>Motivo da reversão</label>
              <input
                id={`${prefix}-reason`}
                maxLength={500}
                onChange={(event) => {
                  setReason(event.target.value);
                }}
                value={reason}
              />
            </div>
          ) : (
            <div className="field">
              <label htmlFor={`${prefix}-amount`}>
                {action === 'prepayment'
                  ? 'Valor pago na antecipação'
                  : 'Valor renegociado'}
              </label>
              <input
                id={`${prefix}-amount`}
                inputMode="decimal"
                onChange={(event) => {
                  setAmount(event.target.value);
                }}
                value={amount}
              />
            </div>
          )}
          {action === 'prepayment' && (
            <div className="field">
              <label htmlFor={`${prefix}-discount`}>Desconto obtido</label>
              <input
                id={`${prefix}-discount`}
                inputMode="decimal"
                onChange={(event) => {
                  setDiscount(event.target.value);
                }}
                value={discount}
              />
            </div>
          )}
          {action === 'renegotiation' && (
            <>
              <div className="field">
                <label htmlFor={`${prefix}-count`}>Novas parcelas</label>
                <input
                  id={`${prefix}-count`}
                  inputMode="numeric"
                  onChange={(event) => {
                    setCount(event.target.value);
                  }}
                  value={count}
                />
              </div>
              <div className="field">
                <label htmlFor={`${prefix}-interest`}>
                  Juros da renegociação
                </label>
                <select
                  id={`${prefix}-interest`}
                  onChange={(event) => {
                    setInterest(event.target.value as Interest);
                  }}
                  value={interest}
                >
                  <option value="none">Sem juros</option>
                  <option value="simple">Juros simples</option>
                  <option value="compound">Juros compostos</option>
                </select>
              </div>
              {interest !== 'none' && (
                <div className="field">
                  <label htmlFor={`${prefix}-rate`}>Taxa ao mês (%)</label>
                  <input
                    id={`${prefix}-rate`}
                    inputMode="decimal"
                    onChange={(event) => {
                      setPercent(event.target.value);
                    }}
                    value={percent}
                  />
                </div>
              )}
            </>
          )}
          <div className="account-actions">
            <button disabled={busy} type="submit">
              {busy ? 'Registrando…' : 'Confirmar'}
            </button>
            <button
              disabled={busy}
              onClick={() => {
                setAction(null);
              }}
              type="button"
            >
              Cancelar
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
