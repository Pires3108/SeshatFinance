'use client';

import type { paths } from '@seshat/contracts';
import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type SyntheticEvent,
} from 'react';

import { formatBalance } from '../accounts/account-presentation';
import { formatCivilDate, type Card } from './card-presentation';
import type { Purchase } from './card-purchases';

type PlanPath =
  paths['/api/v1/credit-cards/{cardId}/purchases/{purchaseId}/installment-plan'];
export type InstallmentPreview =
  paths['/api/v1/credit-cards/{cardId}/purchases/{purchaseId}/installment-plan/preview']['post']['responses'][200]['content']['application/json'];
export type InstallmentPlan =
  PlanPath['post']['responses'][201]['content']['application/json'];

const PERCENT = /^\d{1,3}(?:[.,]\d{1,6})?$/u;

type Method = 'none' | 'simple' | 'compound';

function isPreview(value: unknown): value is InstallmentPreview {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Record<string, unknown>).total === 'string' &&
    Array.isArray((value as Record<string, unknown>).installments)
  );
}

/**
 * Splits a purchase already recorded with the card (US-044). The preview
 * shows principal, interest, total and each installment (RN-021) before the
 * holder confirms; nothing is sent to the card issuer.
 */
export function InstallmentPlanForm({
  card,
  purchase,
  onClose,
  onRecorded,
}: Readonly<{
  card: Card;
  purchase: Purchase;
  onClose: () => void;
  onRecorded: (plan: InstallmentPlan) => void;
}>): ReactNode {
  const [count, setCount] = useState('2');
  const [method, setMethod] = useState<Method>('none');
  const [percent, setPercent] = useState('');
  const [preview, setPreview] = useState<InstallmentPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const keyRef = useRef<string>(crypto.randomUUID());
  const errorRef = useRef<HTMLParagraphElement>(null);
  const base = `/api/cards/${card.id}/purchases/${purchase.id}/installment-plan`;
  const prefix = `installment-${purchase.id}`;

  useEffect(() => {
    if (error !== null) errorRef.current?.focus();
  }, [error]);

  function money(amount: string): string {
    return formatBalance({
      amount,
      currencyCode: card.currencyCode,
      currencyMinorUnitScale: card.currencyMinorUnitScale,
    });
  }

  function request(): Record<string, unknown> | null {
    const installments = Number(count);
    if (
      !Number.isInteger(installments) ||
      installments < 1 ||
      installments > 420
    ) {
      setError('Informe de 1 a 420 parcelas.');
      return null;
    }
    if (method === 'none') return { count: installments, rate: null };
    if (!PERCENT.test(percent.trim())) {
      setError(
        'Informe a taxa mensal em porcentagem, de 0 a 100, com até seis casas (por exemplo 1,99).',
      );
      return null;
    }
    return {
      count: installments,
      rate: {
        method,
        percentPerPeriod: percent.trim().replace(',', '.'),
        periodicity: 'monthly',
      },
    };
  }

  function changed(): void {
    // Any change requires a new preview and a new confirmation key.
    setPreview(null);
    keyRef.current = crypto.randomUUID();
  }

  async function showPreview(
    event: SyntheticEvent<HTMLFormElement, SubmitEvent>,
  ): Promise<void> {
    event.preventDefault();
    if (busy) return;
    setError(null);
    const body = request();
    if (body === null) return;
    setBusy(true);
    try {
      const response = await fetch(`${base}/preview`, {
        body: JSON.stringify(body),
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      });
      const data: unknown = response.ok ? await response.json() : null;
      if (!isPreview(data)) {
        setError(
          response.status === 400
            ? 'Parcelas ou taxa inválidas. Confira os dados.'
            : 'Não foi possível calcular a prévia. Tente novamente.',
        );
        return;
      }
      setPreview(data);
    } catch {
      setError('Não foi possível calcular a prévia. Tente novamente.');
    } finally {
      setBusy(false);
    }
  }

  async function confirm(): Promise<void> {
    if (busy || preview === null) return;
    const body = request();
    if (body === null) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(base, {
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
          response.status === 409
            ? 'Esta compra já foi parcelada.'
            : response.status === 422
              ? 'Não é possível parcelar: alguma fatura do parcelamento já está fechada ou os pagamentos já declarados superam a nova obrigação.'
              : 'Não foi possível registrar o parcelamento. Tente novamente com os mesmos dados.',
        );
        return;
      }
      onRecorded((await response.json()) as InstallmentPlan);
    } catch {
      setError(
        'Não foi possível registrar o parcelamento. Tente novamente com os mesmos dados.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      aria-label={`Parcelar ${purchase.description}`}
      className="installment-plan-form"
      onSubmit={(event) => void showPreview(event)}
    >
      <p className="field-note">
        Registre um parcelamento já feito com o cartão. A compra continua como
        despesa; cada parcela entra na fatura do seu ciclo e as futuras ficam
        como compromissos projetados. Nada é enviado ao emissor.
      </p>
      <div className="field">
        <label htmlFor={`${prefix}-count`}>Número de parcelas</label>
        <input
          id={`${prefix}-count`}
          inputMode="numeric"
          max={420}
          min={1}
          onChange={(event) => {
            setCount(event.target.value);
            changed();
          }}
          type="number"
          value={count}
        />
      </div>
      <div className="field">
        <label htmlFor={`${prefix}-method`}>Juros</label>
        <select
          id={`${prefix}-method`}
          onChange={(event) => {
            setMethod(event.target.value as Method);
            changed();
          }}
          value={method}
        >
          <option value="none">Sem juros</option>
          <option value="simple">Juros simples</option>
          <option value="compound">Juros compostos</option>
        </select>
      </div>
      {method !== 'none' && (
        <div className="field">
          <label htmlFor={`${prefix}-rate`}>Taxa ao mês (%)</label>
          <input
            id={`${prefix}-rate`}
            inputMode="decimal"
            onChange={(event) => {
              setPercent(event.target.value);
              changed();
            }}
            value={percent}
          />
        </div>
      )}
      {error !== null && (
        <p
          className="form-message error"
          ref={errorRef}
          role="alert"
          tabIndex={-1}
        >
          {error}
        </p>
      )}
      {preview !== null && (
        <section aria-label="Prévia do parcelamento" role="region">
          <p>
            Total financiado: {money(preview.principal)} · Juros estimados:{' '}
            {money(preview.interest)} · Total final: {money(preview.total)}
          </p>
          <table>
            <caption>Parcelas previstas</caption>
            <thead>
              <tr>
                <th scope="col">Parcela</th>
                <th scope="col">Valor</th>
                <th scope="col">Juros</th>
                <th scope="col">Fatura que fecha em</th>
                <th scope="col">Vencimento</th>
              </tr>
            </thead>
            <tbody>
              {preview.installments.map((installment) => (
                <tr key={installment.number}>
                  <td>
                    {installment.number}/{preview.count}
                  </td>
                  <td>{money(installment.amount)}</td>
                  <td>{money(installment.interest)}</td>
                  <td>{formatCivilDate(installment.cycleClosesOn)}</td>
                  <td>{formatCivilDate(installment.dueOn)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="field-note">
            Cálculo versão {preview.calculationVersion}: total exato arredondado
            uma única vez; a diferença de centavos fica na última parcela.
          </p>
        </section>
      )}
      <div className="account-actions">
        <button disabled={busy} type="submit">
          {busy && preview === null ? 'Calculando…' : 'Ver prévia'}
        </button>
        <button
          disabled={busy || preview === null}
          onClick={() => void confirm()}
          type="button"
        >
          {busy && preview !== null ? 'Registrando…' : 'Confirmar parcelamento'}
        </button>
        <button disabled={busy} onClick={onClose} type="button">
          Cancelar
        </button>
      </div>
    </form>
  );
}
