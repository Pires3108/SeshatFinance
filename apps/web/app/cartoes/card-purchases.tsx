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

export type Purchase =
  paths['/api/v1/credit-cards/{cardId}/purchases']['get']['responses'][200]['content']['application/json'][number];

const DECIMAL = /^\d+(?:[.,]\d{1,18})?$/u;

function isPurchaseList(value: unknown): value is readonly Purchase[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item: unknown) =>
        typeof item === 'object' &&
        item !== null &&
        typeof (item as Record<string, unknown>).amount === 'string' &&
        typeof (item as Record<string, unknown>).cycleClosesOn === 'string',
    )
  );
}

function localNow(): string {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

export function formatPurchaseAmount(purchase: Purchase): string {
  return formatBalance({
    amount: purchase.amount,
    currencyCode: purchase.currencyCode,
    currencyMinorUnitScale: purchase.currencyMinorUnitScale,
  });
}

/** Purchases of the current cycle and the form to record a past purchase. */
export function CardPurchases({
  card,
  cycleClosesOn,
  onRecorded,
}: Readonly<{
  card: Card;
  cycleClosesOn: string | null;
  onRecorded: () => void;
}>): ReactNode {
  const [purchases, setPurchases] = useState<readonly Purchase[] | null>(null);
  const [open, setOpen] = useState(false);
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [occurredAt, setOccurredAt] = useState(localNow);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<Readonly<{
    kind: 'status' | 'error';
    text: string;
  }> | null>(null);
  const keyRef = useRef<string>('');
  const messageRef = useRef<HTMLParagraphElement>(null);

  const load = useCallback(async (): Promise<void> => {
    if (cycleClosesOn === null) return;
    try {
      const response = await fetch(
        `/api/cards/${card.id}/purchases?cycleClosesOn=${cycleClosesOn}`,
        { cache: 'no-store' },
      );
      const data: unknown = response.ok ? await response.json() : null;
      setPurchases(isPurchaseList(data) ? data : null);
    } catch {
      setPurchases(null);
    }
  }, [card.id, cycleClosesOn]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (message !== null) messageRef.current?.focus();
  }, [message]);

  function start(): void {
    keyRef.current = crypto.randomUUID();
    setDescription('');
    setAmount('');
    setOccurredAt(localNow());
    setMessage(null);
    setOpen(true);
  }

  async function submit(
    event: SyntheticEvent<HTMLFormElement, SubmitEvent>,
  ): Promise<void> {
    event.preventDefault();
    if (saving) return;
    const instant = new Date(occurredAt);
    if (
      description.trim() === '' ||
      !DECIMAL.test(amount.trim()) ||
      Number.isNaN(instant.getTime())
    ) {
      setMessage({
        kind: 'error',
        text: 'Informe a descrição, o valor (por exemplo 120,35) e a data da compra.',
      });
      return;
    }
    setSaving(true);
    try {
      const response = await fetch(`/api/cards/${card.id}/purchases`, {
        body: JSON.stringify({
          amount: amount.trim().replace(',', '.'),
          currencyCode: card.currencyCode,
          currencyMinorUnitScale: card.currencyMinorUnitScale,
          description: description.trim(),
          occurredAt: instant.toISOString(),
        }),
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
            response.status === 409
              ? 'Esta compra já está sendo registrada. Aguarde e recarregue a página.'
              : 'Não foi possível registrar a compra. Confira os dados e tente novamente.',
        });
        return;
      }
      const recorded = (await response.json()) as Purchase;
      setOpen(false);
      setMessage({
        kind: 'status',
        text: `Compra registrada na fatura que fecha em ${formatCivilDate(recorded.cycleClosesOn)}.`,
      });
      await load();
      onRecorded();
    } catch {
      setMessage({
        kind: 'error',
        text: 'Não foi possível registrar a compra. Tente novamente com os mesmos dados.',
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card-purchases">
      <h3>Compras da fatura atual</h3>
      {purchases === null ? (
        <p>Compras indisponíveis no momento.</p>
      ) : purchases.length === 0 ? (
        <p>Nenhuma compra nesta fatura.</p>
      ) : (
        <ul>
          {purchases.map((purchase) => (
            <li key={purchase.id}>
              {purchase.description}: {formatPurchaseAmount(purchase)}
            </li>
          ))}
        </ul>
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
      {open ? (
        <form
          aria-label={`Registrar compra no ${card.name}`}
          onSubmit={(event) => void submit(event)}
        >
          <p className="field-note">
            Registre uma compra já feita com o cartão. Ela entra como despesa e
            na fatura, sem alterar o saldo da conta pagadora até o pagamento.
          </p>
          <div className="field">
            <label htmlFor={`purchase-description-${card.id}`}>Descrição</label>
            <input
              id={`purchase-description-${card.id}`}
              maxLength={500}
              onChange={(event) => {
                setDescription(event.target.value);
              }}
              value={description}
            />
          </div>
          <div className="field">
            <label htmlFor={`purchase-amount-${card.id}`}>
              Valor ({card.currencyCode})
            </label>
            <input
              id={`purchase-amount-${card.id}`}
              inputMode="decimal"
              onChange={(event) => {
                setAmount(event.target.value);
              }}
              value={amount}
            />
          </div>
          <div className="field">
            <label htmlFor={`purchase-date-${card.id}`}>Data e hora</label>
            <input
              id={`purchase-date-${card.id}`}
              onChange={(event) => {
                setOccurredAt(event.target.value);
              }}
              type="datetime-local"
              value={occurredAt}
            />
          </div>
          <div className="account-actions">
            <button disabled={saving} type="submit">
              {saving ? 'Registrando…' : 'Registrar compra'}
            </button>
            <button
              disabled={saving}
              onClick={() => {
                setOpen(false);
              }}
              type="button"
            >
              Cancelar
            </button>
          </div>
        </form>
      ) : (
        <button onClick={start} type="button">
          Registrar compra realizada
        </button>
      )}
    </div>
  );
}
