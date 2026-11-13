'use client';

import type { paths } from '@seshat/contracts';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { formatBalance } from '../accounts/account-presentation';
import { formatPurchaseAmount, type Purchase } from './card-purchases';
import {
  boundaryLabels,
  formatCivilDate,
  type Card,
} from './card-presentation';

export type Invoice =
  paths['/api/v1/credit-cards/{cardId}/invoices']['get']['responses'][200]['content']['application/json'][number];

const statusLabels: Readonly<Record<Invoice['status'], string>> = {
  closed: 'Fechada',
  open: 'Aberta',
};

export function formatInvoiceAmount(invoice: Invoice, amount: string): string {
  return formatBalance({
    amount,
    currencyCode: invoice.currencyCode,
    currencyMinorUnitScale: invoice.currencyMinorUnitScale,
  });
}

function isInvoiceList(value: unknown): value is readonly Invoice[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item: unknown) =>
        typeof item === 'object' &&
        item !== null &&
        typeof (item as Record<string, unknown>).closesOn === 'string' &&
        typeof (item as Record<string, unknown>).purchasesTotal === 'string',
    )
  );
}

/** Invoices of a card with their memory of calculation and manual closing. */
export function CardInvoices({
  card,
  refreshToken,
}: Readonly<{ card: Card; refreshToken: number }>): ReactNode {
  const [invoices, setInvoices] = useState<readonly Invoice[] | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [purchases, setPurchases] = useState<readonly Purchase[] | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Readonly<{
    kind: 'status' | 'error';
    text: string;
  }> | null>(null);
  const messageRef = useRef<HTMLParagraphElement>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      const response = await fetch(`/api/cards/${card.id}/invoices`, {
        cache: 'no-store',
      });
      const data: unknown = response.ok ? await response.json() : null;
      setInvoices(isInvoiceList(data) ? data : null);
    } catch {
      setInvoices(null);
    }
  }, [card.id]);

  useEffect(() => {
    void load();
  }, [load, refreshToken]);

  useEffect(() => {
    if (message !== null) messageRef.current?.focus();
  }, [message]);

  async function toggle(closesOn: string): Promise<void> {
    if (expanded === closesOn) {
      setExpanded(null);
      return;
    }
    setExpanded(closesOn);
    setPurchases(null);
    try {
      const response = await fetch(
        `/api/cards/${card.id}/invoices/${closesOn}`,
        { cache: 'no-store' },
      );
      const data = response.ok
        ? ((await response.json()) as { purchases: Purchase[] })
        : null;
      setPurchases(data?.purchases ?? []);
    } catch {
      setPurchases([]);
    }
  }

  async function close(invoice: Invoice): Promise<void> {
    if (busy) return;
    setBusy(true);
    try {
      const response = await fetch(
        `/api/cards/${card.id}/invoices/${invoice.closesOn}/close`,
        {
          body: '{}',
          cache: 'no-store',
          headers: { 'Content-Type': 'application/json' },
          method: 'POST',
        },
      );
      if (!response.ok) {
        setMessage({
          kind: 'error',
          text: 'Não foi possível fechar a fatura. Tente novamente.',
        });
        return;
      }
      setConfirming(null);
      setMessage({
        kind: 'status',
        text: `Fatura de ${formatCivilDate(invoice.closesOn)} fechada.`,
      });
      await load();
    } catch {
      setMessage({
        kind: 'error',
        text: 'Não foi possível fechar a fatura. Tente novamente.',
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label={`Faturas do ${card.name}`} className="card-invoices">
      <h3>Faturas</h3>
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
      {invoices === null ? (
        <p>Faturas indisponíveis no momento.</p>
      ) : invoices.length === 0 ? (
        <p>
          Nenhuma fatura ainda. Ela é formada com a primeira compra do ciclo.
        </p>
      ) : (
        <ul>
          {invoices.map((invoice) => (
            <li key={invoice.id}>
              <p>
                <strong>
                  Fatura de {formatCivilDate(invoice.closesOn)} —{' '}
                  {statusLabels[invoice.status]}
                </strong>
              </p>
              <p>
                Compras: {formatInvoiceAmount(invoice, invoice.purchasesTotal)}{' '}
                ({invoice.purchaseCount}) · Restante:{' '}
                {formatInvoiceAmount(invoice, invoice.remaining)} · Vence em{' '}
                {formatCivilDate(invoice.dueOn)}
              </p>
              {invoice.dueOn !== invoice.scheduledDueOn && (
                <p className="field-note">
                  Vencimento configurado em{' '}
                  {formatCivilDate(invoice.scheduledDueOn)}, adiado para o
                  próximo dia útil por fim de semana ou feriado.
                </p>
              )}
              <div className="account-actions">
                <button
                  aria-expanded={expanded === invoice.closesOn}
                  onClick={() => void toggle(invoice.closesOn)}
                  type="button"
                >
                  {expanded === invoice.closesOn
                    ? 'Ocultar detalhes'
                    : 'Ver detalhes'}
                </button>
                {invoice.status === 'open' &&
                  (confirming === invoice.closesOn ? (
                    <>
                      <button
                        disabled={busy}
                        onClick={() => void close(invoice)}
                        type="button"
                      >
                        Confirmar fechamento
                      </button>
                      <button
                        disabled={busy}
                        onClick={() => {
                          setConfirming(null);
                        }}
                        type="button"
                      >
                        Cancelar
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => {
                        setConfirming(invoice.closesOn);
                      }}
                      type="button"
                    >
                      Fechar fatura
                    </button>
                  ))}
              </div>
              {confirming === invoice.closesOn && (
                <p className="field-note">
                  Fechar congela o total de compras desta fatura. Compras
                  registradas depois entram na próxima fatura aberta. Nenhuma
                  despesa nova é criada e a conta pagadora não muda.
                </p>
              )}
              {expanded === invoice.closesOn && (
                <div>
                  <p>
                    Compras de {formatCivilDate(invoice.firstPurchaseDate)} a{' '}
                    {formatCivilDate(invoice.lastPurchaseDate)}.{' '}
                    {boundaryLabels[invoice.closingBoundary]}. Fuso{' '}
                    {invoice.timeZone}; base de feriados{' '}
                    {invoice.holidayDatasetVersion}.
                  </p>
                  {invoice.closedTotal !== null && (
                    <p>
                      Total congelado no fechamento:{' '}
                      {formatInvoiceAmount(invoice, invoice.closedTotal)}.
                    </p>
                  )}
                  {purchases === null ? (
                    <p role="status">Carregando compras…</p>
                  ) : (
                    <ul>
                      {purchases.map((purchase) => (
                        <li key={purchase.id}>
                          {purchase.description}:{' '}
                          {formatPurchaseAmount(purchase)}
                          {purchase.postedAfterClose
                            ? ' (lançada após o fechamento da fatura anterior)'
                            : ''}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
