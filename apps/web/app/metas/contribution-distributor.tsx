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

import {
  formatMoney,
  parseDecimalInput,
  type GoalView,
} from './goal-presentation';

type SourceSummary =
  paths['/api/v1/goal-contributions/sources']['get']['responses'][200]['content']['application/json'][number];
type Contribution =
  paths['/api/v1/goal-contributions/{transactionId}']['get']['responses'][200]['content']['application/json'];

function isSourceList(value: unknown): value is SourceSummary[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        typeof item === 'object' &&
        item !== null &&
        typeof (item as Record<string, unknown>).id === 'string',
    )
  );
}

function isContribution(value: unknown): value is Contribution {
  if (typeof value !== 'object' || value === null) return false;
  const item = value as Record<string, unknown>;
  return (
    Array.isArray(item.lines) &&
    typeof item.version === 'number' &&
    typeof item.source === 'object'
  );
}

function scaleOf(amount: string): number {
  return amount.split('.')[1]?.length ?? 0;
}

/** Decimal string to minor units at a scale, without floating point. */
function toMinor(amount: string, scale: number): bigint | null {
  const match = /^(\d+)(?:\.(\d+))?$/u.exec(amount);
  if (match === null) return null;
  const fraction = match[2] ?? '';
  if (fraction.length > scale) return null;
  return BigInt(`${match[1] ?? '0'}${fraction.padEnd(scale, '0')}`);
}

function fromMinor(units: bigint, scale: number): string {
  const negative = units < 0n;
  const digits = (negative ? -units : units)
    .toString()
    .padStart(scale + 1, '0');
  const whole = digits.slice(0, digits.length - scale);
  const fraction = digits.slice(digits.length - scale);
  return `${negative ? '-' : ''}${whole}${scale > 0 ? `.${fraction}` : ''}`;
}

function describeSource(source: SourceSummary): string {
  const date = new Date(source.occurredAt).toLocaleDateString('pt-BR');
  const label =
    source.kind === 'transfer-in' ? 'Transferência recebida' : 'Receita';
  return `${label} de ${formatMoney(source.amount)} em ${date}${source.description === null ? '' : ` — ${source.description}`}`;
}

/**
 * Splits one eligible entry between goals (US-050). The preview shows the
 * remaining value and the errors per goal before the holder confirms; the
 * entry itself is never changed and keeps its full balance value.
 */
export function ContributionDistributor({
  goals,
  onSaved,
}: Readonly<{
  goals: readonly GoalView[];
  onSaved: () => Promise<void>;
}>): ReactNode {
  const [sources, setSources] = useState<readonly SourceSummary[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [sourceId, setSourceId] = useState('');
  const [current, setCurrent] = useState<Contribution | null>(null);
  const [amounts, setAmounts] = useState<Readonly<Record<string, string>>>({});
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const [preview, setPreview] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const keyRef = useRef<string>(crypto.randomUUID());
  const usable = goals.filter((goal) => goal.lifecycle !== 'archived');

  const loadSources = useCallback(async (): Promise<void> => {
    try {
      const response = await fetch('/api/goal-contributions/sources', {
        cache: 'no-store',
      });
      const data: unknown = response.ok ? await response.json() : null;
      if (!isSourceList(data)) {
        setFailed(true);
        return;
      }
      setFailed(false);
      setSources(data);
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    void loadSources();
  }, [loadSources]);

  async function choose(id: string): Promise<void> {
    setSourceId(id);
    setPreview(false);
    setMessage('');
    setError('');
    setErrors({});
    setCurrent(null);
    if (id === '') return;
    try {
      const response = await fetch(
        `/api/goal-contributions/${encodeURIComponent(id)}`,
        { cache: 'no-store' },
      );
      const data: unknown = response.ok ? await response.json() : null;
      if (!isContribution(data)) {
        setError('Não foi possível carregar a distribuição desta entrada.');
        return;
      }
      setCurrent(data);
      setAmounts(
        Object.fromEntries(
          data.lines.map((line) => [
            line.goalId,
            line.amount.amount.replace('.', ','),
          ]),
        ),
      );
    } catch {
      setError('Não foi possível carregar a distribuição desta entrada.');
    }
  }

  if (failed) {
    return (
      <section aria-labelledby="distribute-title">
        <h2 id="distribute-title">Distribuir entrada entre metas</h2>
        <p role="alert">
          Entradas indisponíveis.{' '}
          <button onClick={() => void loadSources()} type="button">
            Tentar novamente
          </button>
        </p>
      </section>
    );
  }
  if (sources === null) return <p>Carregando entradas…</p>;

  const scale = current === null ? 2 : scaleOf(current.source.amount.amount);
  const sourceUnits =
    current === null
      ? 0n
      : (toMinor(current.source.amount.amount, scale) ?? 0n);
  const currency = current?.source.amount.currencyCode ?? '';

  function computeLines(): Readonly<{
    lines: { goalId: string; amount: string }[];
    total: bigint;
  }> | null {
    const found: Record<string, string> = {};
    const lines: { goalId: string; amount: string }[] = [];
    let total = 0n;
    for (const goal of usable) {
      const raw = (amounts[goal.id] ?? '').trim();
      if (raw === '') continue;
      const decimal = parseDecimalInput(raw);
      const units = decimal === null ? null : toMinor(decimal, scale);
      if (decimal === null || units === null) {
        found[goal.id] =
          `Valor inválido para ${goal.name}: use até ${String(scale)} casas decimais.`;
        continue;
      }
      if (units === 0n) continue;
      total += units;
      lines.push({ amount: decimal, goalId: goal.id });
    }
    setErrors(found);
    if (Object.keys(found).length > 0) return null;
    return { lines, total };
  }

  const computed = preview ? computeTotals() : null;
  function computeTotals(): bigint {
    let total = 0n;
    for (const goal of usable) {
      const decimal = parseDecimalInput((amounts[goal.id] ?? '').trim());
      const units = decimal === null ? null : toMinor(decimal, scale);
      if (units !== null) total += units;
    }
    return total;
  }

  function review(event: SyntheticEvent<HTMLFormElement>): void {
    event.preventDefault();
    setMessage('');
    setError('');
    const result = computeLines();
    if (result === null) return;
    if (result.total > sourceUnits) {
      setError(
        `A soma (${formatMoney({ amount: fromMinor(result.total, scale), currencyCode: currency })}) passa do valor da entrada (${formatMoney({ amount: fromMinor(sourceUnits, scale), currencyCode: currency })}). Nada foi distribuído.`,
      );
      return;
    }
    setPreview(true);
  }

  async function confirm(): Promise<void> {
    if (current === null) return;
    const result = computeLines();
    if (result === null) return;
    setBusy(true);
    setError('');
    try {
      const response = await fetch(
        `/api/goal-contributions/${encodeURIComponent(sourceId)}`,
        {
          body: JSON.stringify({
            expectedVersion: current.version,
            lines: result.lines,
          }),
          headers: {
            'Content-Type': 'application/json',
            'Idempotency-Key': keyRef.current,
          },
          method: 'PUT',
        },
      );
      const data: unknown = response.ok ? await response.json() : null;
      keyRef.current = crypto.randomUUID();
      setPreview(false);
      if (response.ok && isContribution(data)) {
        setCurrent(data);
        setMessage(
          data.lines.length === 0
            ? 'Distribuição removida. A entrada continua com o valor integral no saldo.'
            : `Distribuição salva. Restante da entrada: ${formatMoney(data.remaining)}. A entrada continua com o valor integral no saldo.`,
        );
        await Promise.all([onSaved(), loadSources()]);
        return;
      }
      if (response.status === 422) {
        setError(
          'A distribuição foi recusada: a soma passa da entrada, a entrada está na lixeira ou uma meta está indisponível. Nada foi distribuído.',
        );
      } else if (response.status === 409) {
        setError(
          'A distribuição foi alterada em outra tela. Os valores foram recarregados; revise e tente de novo.',
        );
        await choose(sourceId);
      } else {
        setError('Não foi possível salvar a distribuição. Tente novamente.');
      }
    } catch {
      setError('Não foi possível salvar a distribuição. Tente novamente.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="distribute-title" className="goal-distributor">
      <h2 id="distribute-title">Distribuir entrada entre metas</h2>
      <p className="account-note">
        Escolha uma receita ou transferência recebida e indique quanto vai para
        cada meta. A entrada não muda: ela continua valendo o valor integral no
        saldo, e a soma das partes não pode passar dela.
      </p>
      {sources.length === 0 ? (
        <p>Nenhuma entrada elegível registrada.</p>
      ) : (
        <label>
          Entrada
          <select
            onChange={(event) => void choose(event.target.value)}
            value={sourceId}
          >
            <option value="">Selecione uma entrada</option>
            {sources.map((source) => (
              <option key={source.id} value={source.id}>
                {describeSource(source)}
              </option>
            ))}
          </select>
        </label>
      )}
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
      {current !== null && usable.length === 0 && (
        <p>Crie uma meta ativa para distribuir esta entrada.</p>
      )}
      {current !== null && usable.length > 0 && (
        <form noValidate onSubmit={review}>
          {usable.map((goal) => (
            <div className="goal-distributor-line" key={goal.id}>
              <label htmlFor={`distribute-${goal.id}`}>
                Para {goal.name} ({currency})
              </label>
              <input
                aria-describedby={
                  errors[goal.id] === undefined
                    ? undefined
                    : `distribute-error-${goal.id}`
                }
                aria-invalid={errors[goal.id] !== undefined}
                id={`distribute-${goal.id}`}
                inputMode="decimal"
                onChange={(event) => {
                  setPreview(false);
                  setAmounts({ ...amounts, [goal.id]: event.target.value });
                }}
                value={amounts[goal.id] ?? ''}
              />
              {errors[goal.id] !== undefined && (
                <p
                  className="form-message error"
                  id={`distribute-error-${goal.id}`}
                >
                  {errors[goal.id]}
                </p>
              )}
            </div>
          ))}
          {!preview && (
            <button disabled={busy} type="submit">
              Revisar distribuição
            </button>
          )}
        </form>
      )}
      {preview && computed !== null && current !== null && (
        <div aria-live="polite" className="reserve-preview" role="group">
          <p>
            Distribuir{' '}
            {formatMoney({
              amount: fromMinor(computed, scale),
              currencyCode: currency,
            })}{' '}
            de {formatMoney(current.source.amount)}. Restante da entrada:{' '}
            {formatMoney({
              amount: fromMinor(sourceUnits - computed, scale),
              currencyCode: currency,
            })}
            . O saldo da conta não muda.
          </p>
          <button disabled={busy} onClick={() => void confirm()} type="button">
            Confirmar distribuição
          </button>
          <button
            disabled={busy}
            onClick={() => {
              setPreview(false);
            }}
            type="button"
          >
            Cancelar
          </button>
        </div>
      )}
    </section>
  );
}
