'use client';

import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type SyntheticEvent,
} from 'react';

import type { AccountWithBalance } from '../accounts/account-contract';
import { formatBalance } from '../accounts/account-presentation';
import { formatInvoiceAmount, type Invoice } from './card-invoices';
import { formatCivilDate, type Card } from './card-presentation';
import { subtractDecimal } from './decimal-math';

const DECIMAL = /^\d+(?:[.,]\d{1,18})?$/u;

function localNow(): string {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);
}

/** Declares a payment made outside the app; it never pays anything. */
export function InvoiceSettlementForm({
  card,
  invoice,
  onDone,
}: Readonly<{
  card: Card;
  invoice: Invoice;
  onDone: (message: string | null) => void;
}>): ReactNode {
  const [accounts, setAccounts] = useState<readonly AccountWithBalance[]>([]);
  const [accountId, setAccountId] = useState(card.paymentAccountId);
  const [amount, setAmount] = useState(invoice.remaining.replace('.', ','));
  const [paidAt, setPaidAt] = useState(localNow);
  const [confirmed, setConfirmed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const keyRef = useRef(crypto.randomUUID());
  const errorRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
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
  }, []);

  useEffect(() => {
    if (error !== null) errorRef.current?.focus();
  }, [error]);

  const eligible = accounts.filter(
    ({ account }) => account.currencyCode === invoice.currencyCode,
  );
  const selected = eligible.find(({ account }) => account.id === accountId);
  const normalized = amount.trim().replace(',', '.');
  const validAmount = DECIMAL.test(amount.trim());
  const scale = invoice.currencyMinorUnitScale;

  async function submit(
    event: SyntheticEvent<HTMLFormElement, SubmitEvent>,
  ): Promise<void> {
    event.preventDefault();
    if (saving) return;
    const instant = new Date(paidAt);
    if (!validAmount || Number.isNaN(instant.getTime()) || !confirmed) {
      setError(
        'Informe o valor e a data e confirme que o pagamento já foi feito.',
      );
      return;
    }
    setSaving(true);
    try {
      const response = await fetch(
        `/api/cards/${card.id}/invoices/${invoice.closesOn}/settlements`,
        {
          body: JSON.stringify({
            accountId,
            amount: normalized,
            currencyCode: invoice.currencyCode,
            currencyMinorUnitScale: scale,
            paidAt: instant.toISOString(),
          }),
          cache: 'no-store',
          headers: {
            'Content-Type': 'application/json',
            'Idempotency-Key': keyRef.current,
          },
          method: 'POST',
        },
      );
      if (response.status === 400 || response.status === 409) {
        setError(
          'Não foi possível registrar o pagamento. Confira os dados e tente novamente.',
        );
        return;
      }
      if (!response.ok) {
        setError(
          response.status === 422
            ? 'O valor é maior que o restante da fatura ou a conta não é compatível.'
            : 'Serviço indisponível. Tente novamente com os mesmos dados.',
        );
        return;
      }
      onDone(
        `Pagamento de ${formatInvoiceAmount(invoice, normalized)} registrado na fatura de ${formatCivilDate(invoice.closesOn)}.`,
      );
    } catch {
      setError('Não foi possível registrar o pagamento. Tente novamente.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      aria-label={`Registrar pagamento da fatura de ${formatCivilDate(invoice.closesOn)}`}
      onSubmit={(event) => void submit(event)}
    >
      <p className="field-note">
        Registre um pagamento que você já fez fora da Seshat Finance. Nada é
        pago por aqui: o saldo da conta e o restante da fatura diminuem pelo
        mesmo valor, sem criar nova despesa.
      </p>
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
      <div className="field">
        <label htmlFor={`settlement-account-${invoice.id}`}>
          Conta usada no pagamento
        </label>
        <select
          id={`settlement-account-${invoice.id}`}
          onChange={(event) => {
            setAccountId(event.target.value);
          }}
          value={accountId}
        >
          {eligible.map(({ account }) => (
            <option key={account.id} value={account.id}>
              {account.name}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor={`settlement-amount-${invoice.id}`}>
          Valor pago ({invoice.currencyCode})
        </label>
        <input
          id={`settlement-amount-${invoice.id}`}
          inputMode="decimal"
          onChange={(event) => {
            setAmount(event.target.value);
          }}
          value={amount}
        />
      </div>
      <div className="field">
        <label htmlFor={`settlement-date-${invoice.id}`}>
          Data do pagamento
        </label>
        <input
          id={`settlement-date-${invoice.id}`}
          onChange={(event) => {
            setPaidAt(event.target.value);
          }}
          type="datetime-local"
          value={paidAt}
        />
      </div>
      {validAmount && (
        <p aria-live="polite">
          Restante da fatura: {formatInvoiceAmount(invoice, invoice.remaining)}{' '}
          →{' '}
          {formatInvoiceAmount(
            invoice,
            subtractDecimal(invoice.remaining, normalized, scale),
          )}
          {selected === undefined
            ? ''
            : ` · Saldo da conta: ${formatBalance(selected.balance)} → ${formatBalance(
                {
                  ...selected.balance,
                  amount: subtractDecimal(
                    selected.balance.amount,
                    normalized,
                    selected.balance.currencyMinorUnitScale,
                  ),
                },
              )}`}
        </p>
      )}
      <label>
        <input
          checked={confirmed}
          onChange={(event) => {
            setConfirmed(event.target.checked);
          }}
          type="checkbox"
        />{' '}
        Confirmo que este pagamento já foi feito fora da Seshat Finance
      </label>
      <div className="account-actions">
        <button disabled={saving || !confirmed} type="submit">
          {saving ? 'Registrando…' : 'Registrar pagamento realizado'}
        </button>
        <button
          disabled={saving}
          onClick={() => {
            onDone(null);
          }}
          type="button"
        >
          Cancelar
        </button>
      </div>
    </form>
  );
}
