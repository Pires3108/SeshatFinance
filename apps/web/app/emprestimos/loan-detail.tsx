'use client';

import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type SyntheticEvent,
} from 'react';

import { formatCivilDate } from '../cartoes/card-presentation';
import {
  emptyTerms,
  TermsFields,
  termsPayload,
  type TermsDraft,
} from './loan-terms';
import {
  decimalInput,
  eventLabels,
  formatLoanAmount,
  localToday,
  situationLabels,
  type LoanEventView,
  type LoanView,
} from './loan-presentation';

type Action =
  | Readonly<{ kind: 'payment' }>
  | Readonly<{ kind: 'prepayment' }>
  | Readonly<{ kind: 'reversal'; event: LoanEventView }>
  | Readonly<{ kind: 'renegotiation' }>;

type Excess = 'none' | 'extra-amortization' | 'receivable-credit';

const problemMessages: Record<number, string> = {
  409: 'Esta declaração já está sendo registrada. Aguarde e recarregue a página.',
  422: 'A declaração não fecha com o saldo do empréstimo. Confira o valor, a data e a classificação do excedente.',
};

/** Schedule, history and declarations of one loan (US-047). */
export function LoanDetail({
  loan,
  onChanged,
}: Readonly<{ loan: LoanView; onChanged: () => Promise<void> }>): ReactNode {
  const [action, setAction] = useState<Action | null>(null);
  const [date, setDate] = useState(localToday);
  const [amount, setAmount] = useState('');
  const [discount, setDiscount] = useState('0');
  const [excess, setExcess] = useState<Excess>('none');
  const [reason, setReason] = useState('');
  const [terms, setTerms] = useState<TermsDraft>(emptyTerms);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<Readonly<{
    kind: 'status' | 'error';
    text: string;
  }> | null>(null);
  const keyRef = useRef('');
  const messageRef = useRef<HTMLParagraphElement>(null);
  const active = loan.status === 'active';
  const prefix = `loan-${loan.id}`;

  useEffect(() => {
    if (message !== null) messageRef.current?.focus();
  }, [message]);

  function begin(next: Action): void {
    keyRef.current = crypto.randomUUID();
    setDate(localToday());
    setAmount(next.kind === 'prepayment' ? loan.pending : '');
    setDiscount('0');
    setExcess('none');
    setReason('');
    setTerms({
      ...emptyTerms(),
      description: `${loan.description} (renegociado)`,
      principal: loan.pending,
    });
    setMessage(null);
    setAction(next);
  }

  function body(): Readonly<{ path: string; payload: unknown }> | string {
    if (action === null) return 'Escolha uma declaração.';
    if (action.kind === 'reversal') {
      if (reason.trim() === '') return 'Informe o motivo da reversão.';
      return {
        path: 'events',
        payload: {
          kind: 'reversal',
          reason: reason.trim(),
          reversedEventId: action.event.id,
        },
      };
    }
    if (action.kind === 'renegotiation') {
      const payload = termsPayload(terms);
      if (typeof payload === 'string') return payload;
      return {
        path: 'renegotiation',
        payload: { occurredOn: date, terms: payload },
      };
    }
    const value = decimalInput(amount);
    if (value === null) return 'Informe o valor, por exemplo 40,00.';
    if (action.kind === 'prepayment') {
      const off = decimalInput(discount);
      if (off === null) return 'Informe o desconto, ou 0.';
      return {
        path: 'events',
        payload: {
          amount: value,
          discount: off,
          kind: 'prepayment',
          occurredOn: date,
        },
      };
    }
    return {
      path: 'events',
      payload: {
        amount: value,
        excess: excess === 'none' ? null : excess,
        kind: 'payment',
        occurredOn: date,
      },
    };
  }

  async function submit(
    event: SyntheticEvent<HTMLFormElement, SubmitEvent>,
  ): Promise<void> {
    event.preventDefault();
    if (saving) return;
    const request = body();
    if (typeof request === 'string') {
      setMessage({ kind: 'error', text: request });
      return;
    }
    setSaving(true);
    try {
      const response = await fetch(`/api/loans/${loan.id}/${request.path}`, {
        body: JSON.stringify(request.payload),
        cache: 'no-store',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': keyRef.current,
        },
        method: 'POST',
      });
      if (!response.ok) {
        setMessage({
          kind: 'error',
          text:
            problemMessages[response.status] ??
            'Não foi possível registrar a declaração. Tente novamente com os mesmos dados.',
        });
        return;
      }
      setAction(null);
      setMessage({
        kind: 'status',
        text:
          request.path === 'renegotiation'
            ? 'Renegociação registrada: o contrato anterior foi mantido como renegociado e um novo empréstimo foi criado.'
            : 'Declaração registrada. Saldo pendente atualizado.',
      });
      await onChanged();
    } catch {
      setMessage({
        kind: 'error',
        text: 'Não foi possível registrar a declaração. Tente novamente com os mesmos dados.',
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="loan-detail">
      <table>
        <caption>Cronograma de {loan.description}</caption>
        <thead>
          <tr>
            <th scope="col">Parcela</th>
            <th scope="col">Vencimento</th>
            <th scope="col">Valor</th>
            <th scope="col">Juros</th>
            <th scope="col">Pago</th>
            <th scope="col">Restante</th>
            <th scope="col">Situação</th>
          </tr>
        </thead>
        <tbody>
          {loan.installments.map((item) => (
            <tr key={item.number}>
              <td>
                {item.number}/{loan.count}
              </td>
              <td>
                {formatCivilDate(item.dueOn)}
                {item.dueOn !== item.scheduledDueOn
                  ? ` (previsto ${formatCivilDate(item.scheduledDueOn)})`
                  : ''}
              </td>
              <td>{formatLoanAmount(loan, item.amount)}</td>
              <td>{formatLoanAmount(loan, item.interest)}</td>
              <td>{formatLoanAmount(loan, item.paid)}</td>
              <td>{formatLoanAmount(loan, item.remaining)}</td>
              <td>
                {situationLabels[item.situation]}
                {item.declaredFee !== null
                  ? ` · multa declarada ${formatLoanAmount(loan, item.declaredFee)}`
                  : item.estimatedFee !== null && item.estimatedFee !== '0.00'
                    ? ` · multa estimada ${formatLoanAmount(loan, item.estimatedFee)}`
                    : ''}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p>
        Pago até agora: {formatLoanAmount(loan, loan.paidTotal)} · Pendente:{' '}
        {formatLoanAmount(loan, loan.pending)}
        {loan.credit !== '0.00'
          ? ` · Crédito com a contraparte: ${formatLoanAmount(loan, loan.credit)}`
          : ''}
      </p>
      {loan.events.length > 0 && (
        <>
          <h3>Histórico</h3>
          <ul>
            {loan.events.map((event) => (
              <li key={event.id}>
                {eventLabels[event.kind]}
                {event.occurredOn === null
                  ? ''
                  : ` em ${formatCivilDate(event.occurredOn)}`}
                {event.amount === null
                  ? ''
                  : `: ${formatLoanAmount(loan, event.amount)}`}
                {event.discount !== null && event.discount !== '0.00'
                  ? ` (desconto ${formatLoanAmount(loan, event.discount)})`
                  : ''}
                {event.reason === null ? '' : ` — ${event.reason}`}
                {event.reversed ? ' (revertido)' : ''}
                {active &&
                  !event.reversed &&
                  (event.kind === 'payment' || event.kind === 'prepayment') && (
                    <>
                      {' '}
                      <button
                        aria-label={`Reverter ${eventLabels[event.kind].toLowerCase()} de ${event.amount ?? ''}`}
                        onClick={() => {
                          begin({ event, kind: 'reversal' });
                        }}
                        type="button"
                      >
                        Reverter
                      </button>
                    </>
                  )}
              </li>
            ))}
          </ul>
        </>
      )}
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
      {active && action === null && (
        <div className="account-actions">
          <button
            onClick={() => {
              begin({ kind: 'payment' });
            }}
            type="button"
          >
            Registrar pagamento
          </button>
          <button
            onClick={() => {
              begin({ kind: 'prepayment' });
            }}
            type="button"
          >
            Registrar quitação antecipada
          </button>
          <button
            onClick={() => {
              begin({ kind: 'renegotiation' });
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
            action.kind === 'payment'
              ? 'Registrar pagamento'
              : action.kind === 'prepayment'
                ? 'Registrar quitação antecipada'
                : action.kind === 'reversal'
                  ? 'Reverter declaração'
                  : 'Registrar renegociação'
          }
          onSubmit={(event) => void submit(event)}
        >
          <p className="field-note">
            Registre algo que já aconteceu fora do Seshat. Correções são feitas
            por reversão; nada é apagado do histórico.
          </p>
          {action.kind !== 'reversal' && (
            <div className="field">
              <label htmlFor={`${prefix}-date`}>Data</label>
              <input
                id={`${prefix}-date`}
                max={localToday()}
                onChange={(event) => {
                  setDate(event.target.value);
                }}
                type="date"
                value={date}
              />
            </div>
          )}
          {(action.kind === 'payment' || action.kind === 'prepayment') && (
            <div className="field">
              <label htmlFor={`${prefix}-amount`}>Valor pago (BRL)</label>
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
          {action.kind === 'prepayment' && (
            <div className="field">
              <label htmlFor={`${prefix}-discount`}>Desconto (BRL)</label>
              <input
                id={`${prefix}-discount`}
                inputMode="decimal"
                onChange={(event) => {
                  setDiscount(event.target.value);
                }}
                value={discount}
              />
              <p className="field-note">
                Valor pago mais desconto deve ser igual ao pendente na data.
              </p>
            </div>
          )}
          {action.kind === 'payment' && (
            <div className="field">
              <label htmlFor={`${prefix}-excess`}>
                Se passar do valor já vencido
              </label>
              <select
                id={`${prefix}-excess`}
                onChange={(event) => {
                  setExcess(event.target.value as Excess);
                }}
                value={excess}
              >
                <option value="none">
                  Não classificar (recusar excedente)
                </option>
                <option value="extra-amortization">
                  Antecipar as próximas parcelas
                </option>
                <option value="receivable-credit">
                  Registrar como crédito com a contraparte
                </option>
              </select>
            </div>
          )}
          {action.kind === 'reversal' && (
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
          )}
          {action.kind === 'renegotiation' && (
            <TermsFields
              draft={terms}
              prefix={`${prefix}-renegotiation`}
              setDraft={setTerms}
            />
          )}
          <div className="account-actions">
            <button disabled={saving} type="submit">
              {saving ? 'Registrando…' : 'Confirmar'}
            </button>
            <button
              disabled={saving}
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
    </div>
  );
}
