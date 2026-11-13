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

type DeclaredHoliday = Readonly<{
  day: number;
  id: string;
  month: number;
  name: string;
  year: number | null;
}>;
type Settings = Readonly<{
  datasetVersion: string;
  declared: readonly DeclaredHoliday[];
  municipalityCode: string | null;
  stateCode: string | null;
}>;
type LoadState = 'loading' | 'ready' | 'unauthorized' | 'unavailable';

const states: readonly (readonly [string, string])[] = [
  ['AC', 'Acre'],
  ['AL', 'Alagoas'],
  ['AP', 'Amapá'],
  ['AM', 'Amazonas'],
  ['BA', 'Bahia'],
  ['CE', 'Ceará'],
  ['DF', 'Distrito Federal'],
  ['ES', 'Espírito Santo'],
  ['GO', 'Goiás'],
  ['MA', 'Maranhão'],
  ['MT', 'Mato Grosso'],
  ['MS', 'Mato Grosso do Sul'],
  ['MG', 'Minas Gerais'],
  ['PA', 'Pará'],
  ['PB', 'Paraíba'],
  ['PR', 'Paraná'],
  ['PE', 'Pernambuco'],
  ['PI', 'Piauí'],
  ['RJ', 'Rio de Janeiro'],
  ['RN', 'Rio Grande do Norte'],
  ['RS', 'Rio Grande do Sul'],
  ['RO', 'Rondônia'],
  ['RR', 'Roraima'],
  ['SC', 'Santa Catarina'],
  ['SP', 'São Paulo'],
  ['SE', 'Sergipe'],
  ['TO', 'Tocantins'],
];

function isSettings(value: unknown): value is Settings {
  if (typeof value !== 'object' || value === null) return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.datasetVersion === 'string' && Array.isArray(item.declared)
  );
}

function formatHolidayDate(holiday: DeclaredHoliday): string {
  const day = String(holiday.day).padStart(2, '0');
  const month = String(holiday.month).padStart(2, '0');
  return holiday.year === null
    ? `${day}/${month} (todo ano)`
    : `${day}/${month}/${String(holiday.year)}`;
}

export function HolidaySettingsForm(): ReactNode {
  const [state, setState] = useState<LoadState>('loading');
  const [settings, setSettings] = useState<Settings | null>(null);
  const [stateCode, setStateCode] = useState('');
  const [municipalityCode, setMunicipalityCode] = useState('');
  const [holiday, setHoliday] = useState({
    day: '',
    month: '',
    name: '',
    year: '',
  });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Readonly<{
    kind: 'status' | 'error';
    text: string;
  }> | null>(null);
  const messageRef = useRef<HTMLParagraphElement>(null);

  const apply = useCallback((value: Settings): void => {
    setSettings(value);
    setStateCode(value.stateCode ?? '');
    setMunicipalityCode(value.municipalityCode ?? '');
  }, []);

  const load = useCallback(async (): Promise<void> => {
    try {
      const response = await fetch('/api/users/me/holiday-settings', {
        cache: 'no-store',
      });
      if (response.status === 401) {
        setState('unauthorized');
        return;
      }
      const data: unknown = response.ok ? await response.json() : null;
      if (!isSettings(data)) {
        setState('unavailable');
        return;
      }
      apply(data);
      setState('ready');
    } catch {
      setState('unavailable');
    }
  }, [apply]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (message !== null) messageRef.current?.focus();
  }, [message]);

  async function send(
    url: string,
    method: 'PUT' | 'POST' | 'DELETE',
    body: unknown,
    success: string,
  ): Promise<boolean> {
    setBusy(true);
    try {
      const response = await fetch(url, {
        cache: 'no-store',
        method,
        ...(body === undefined
          ? {}
          : {
              body: JSON.stringify(body),
              headers: { 'Content-Type': 'application/json' },
            }),
      });
      if (!response.ok) {
        setMessage({
          kind: 'error',
          text:
            response.status === 400
              ? 'Dados inválidos. Confira a UF, o código do município e a data.'
              : 'Não foi possível salvar. Tente novamente.',
        });
        return false;
      }
      await load();
      setMessage({ kind: 'status', text: success });
      return true;
    } catch {
      setMessage({
        kind: 'error',
        text: 'Não foi possível salvar. Tente novamente.',
      });
      return false;
    } finally {
      setBusy(false);
    }
  }

  function saveLocation(
    event: SyntheticEvent<HTMLFormElement, SubmitEvent>,
  ): void {
    event.preventDefault();
    const municipality = municipalityCode.trim();
    if (municipality !== '' && !/^\d{7}$/u.test(municipality)) {
      setMessage({
        kind: 'error',
        text: 'O código do município do IBGE tem 7 dígitos.',
      });
      return;
    }
    void send(
      '/api/users/me/holiday-settings/location',
      'PUT',
      {
        municipalityCode: municipality === '' ? null : municipality,
        stateCode: stateCode === '' ? null : stateCode,
      },
      'Local dos feriados atualizado.',
    );
  }

  function declare(event: SyntheticEvent<HTMLFormElement, SubmitEvent>): void {
    event.preventDefault();
    const day = Number(holiday.day);
    const month = Number(holiday.month);
    const year = holiday.year.trim() === '' ? null : Number(holiday.year);
    if (
      holiday.name.trim() === '' ||
      !Number.isInteger(day) ||
      !Number.isInteger(month) ||
      (year !== null && !Number.isInteger(year))
    ) {
      setMessage({
        kind: 'error',
        text: 'Informe o nome, o dia e o mês do feriado.',
      });
      return;
    }
    void send(
      '/api/users/me/holiday-settings/declared',
      'POST',
      { day, month, name: holiday.name.trim(), year },
      'Feriado declarado.',
    ).then((saved) => {
      if (saved) setHoliday({ day: '', month: '', name: '', year: '' });
    });
  }

  return (
    <section aria-labelledby="holiday-settings-title" className="form-panel">
      <h2 id="holiday-settings-title">Feriados do seu local</h2>
      <p>
        Usados para levar o vencimento das faturas de cartão ao próximo dia
        útil. Já consideramos fins de semana, feriados nacionais, Carnaval e
        31/12.
      </p>
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
      {state === 'loading' && <p role="status">Carregando feriados…</p>}
      {state === 'unauthorized' && (
        <p role="alert">
          Sua sessão expirou. <Link href="/entrar">Entre novamente</Link>.
        </p>
      )}
      {state === 'unavailable' && (
        <p role="alert">Não foi possível carregar os feriados.</p>
      )}
      {state === 'ready' && settings !== null && (
        <>
          <form onSubmit={saveLocation}>
            <div className="field">
              <label htmlFor="holiday-state">Estado (UF)</label>
              <select
                id="holiday-state"
                onChange={(event) => {
                  setStateCode(event.target.value);
                }}
                value={stateCode}
              >
                <option value="">Não informado</option>
                {states.map(([code, name]) => (
                  <option key={code} value={code}>
                    {name} ({code})
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="holiday-municipality">
                Código do município (IBGE)
              </label>
              <input
                aria-describedby="holiday-municipality-note"
                id="holiday-municipality"
                inputMode="numeric"
                maxLength={7}
                onChange={(event) => {
                  setMunicipalityCode(event.target.value);
                }}
                value={municipalityCode}
              />
              <p className="field-note" id="holiday-municipality-note">
                Sete dígitos, por exemplo 3550308 para São Paulo. Feriados
                municipais já vêm cadastrados para as capitais; para outras
                cidades, declare-os abaixo.
              </p>
            </div>
            <button disabled={busy} type="submit">
              Salvar local
            </button>
          </form>
          <h3>Feriados declarados por você</h3>
          {settings.declared.length === 0 ? (
            <p>Nenhum feriado declarado.</p>
          ) : (
            <ul>
              {settings.declared.map((item) => (
                <li key={item.id}>
                  {item.name} — {formatHolidayDate(item)}{' '}
                  <button
                    disabled={busy}
                    onClick={() =>
                      void send(
                        `/api/users/me/holiday-settings/declared/${item.id}`,
                        'DELETE',
                        undefined,
                        'Feriado removido.',
                      )
                    }
                    type="button"
                  >
                    Remover {item.name}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <form onSubmit={declare}>
            <div className="field">
              <label htmlFor="holiday-name">Nome do feriado</label>
              <input
                id="holiday-name"
                maxLength={120}
                onChange={(event) => {
                  setHoliday({ ...holiday, name: event.target.value });
                }}
                value={holiday.name}
              />
            </div>
            <div className="field">
              <label htmlFor="holiday-day">Dia</label>
              <input
                id="holiday-day"
                inputMode="numeric"
                onChange={(event) => {
                  setHoliday({ ...holiday, day: event.target.value });
                }}
                value={holiday.day}
              />
            </div>
            <div className="field">
              <label htmlFor="holiday-month">Mês</label>
              <input
                id="holiday-month"
                inputMode="numeric"
                onChange={(event) => {
                  setHoliday({ ...holiday, month: event.target.value });
                }}
                value={holiday.month}
              />
            </div>
            <div className="field">
              <label htmlFor="holiday-year">Ano (opcional)</label>
              <input
                aria-describedby="holiday-year-note"
                id="holiday-year"
                inputMode="numeric"
                onChange={(event) => {
                  setHoliday({ ...holiday, year: event.target.value });
                }}
                value={holiday.year}
              />
              <p className="field-note" id="holiday-year-note">
                Deixe em branco para repetir todo ano.
              </p>
            </div>
            <button disabled={busy} type="submit">
              Declarar feriado
            </button>
          </form>
          <p className="field-note">
            Base de feriados: versão {settings.datasetVersion}.
          </p>
        </>
      )}
    </section>
  );
}
