'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

type LoadState = 'loading' | 'ready' | 'unauthorized' | 'unavailable';
type Scope = 'reinterpret_existing' | 'new_items_only';
type SaveState =
  'idle' | 'saving' | 'saved' | 'unauthorized' | 'conflict' | 'failed';

const saveMessages: Readonly<Partial<Record<SaveState, ReactNode>>> = {
  unauthorized: (
    <>
      Sua sessão expirou. <Link href="/entrar">Entre novamente</Link> para
      alterar o fuso.
    </>
  ),
  conflict:
    'Seu perfil foi alterado em outra sessão. Recarregue a página e tente novamente.',
  failed: 'Não foi possível salvar o fuso. Tente novamente.',
};

function timeZoneOptions(current: string): readonly string[] {
  return [...new Set([current, ...Intl.supportedValuesOf('timeZone')])].sort();
}

export function TimeZoneForm({
  children,
}: {
  children?: ReactNode;
}): ReactNode {
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [current, setCurrent] = useState('');
  const [selected, setSelected] = useState('');
  const [scope, setScope] = useState<Scope | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const messageRef = useRef<HTMLParagraphElement>(null);
  const options = useMemo(
    () => (current === '' ? [] : timeZoneOptions(current)),
    [current],
  );

  useEffect(() => {
    const controller = new AbortController();
    async function load(): Promise<void> {
      try {
        const response = await fetch('/api/users/me/profile', {
          cache: 'no-store',
          signal: controller.signal,
        });
        if (response.status === 401) {
          setLoadState('unauthorized');
          return;
        }
        if (!response.ok) {
          setLoadState('unavailable');
          return;
        }
        const profile = (await response.json()) as { timeZone: string };
        setCurrent(profile.timeZone);
        setSelected(profile.timeZone);
        setLoadState('ready');
      } catch {
        if (!controller.signal.aborted) setLoadState('unavailable');
      }
    }
    void load();
    return () => {
      controller.abort();
    };
  }, []);

  useEffect(() => {
    if (saveState !== 'idle' && saveState !== 'saving')
      messageRef.current?.focus();
  }, [saveState]);

  const changed = selected !== current;

  async function save(): Promise<void> {
    if (!changed || scope === null || saveState === 'saving') return;
    setSaveState('saving');
    try {
      const response = await fetch('/api/users/me/profile', {
        method: 'PATCH',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          timeZone: selected,
          timeZoneChangeScope: scope,
        }),
      });
      if (response.status === 401) {
        setSaveState('unauthorized');
        return;
      }
      if (response.status === 409) {
        setSaveState('conflict');
        return;
      }
      if (!response.ok) {
        setSaveState('failed');
        return;
      }
      setCurrent(selected);
      setScope(null);
      setSaveState('saved');
    } catch {
      setSaveState('failed');
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
        <Link href="/movimentacoes">Movimentações</Link>
      </header>
      <main className="accounts-page" id="main-content" tabIndex={-1}>
        <div className="accounts-heading">
          <span className="section-label">Sua conta</span>
          <h1>Preferências</h1>
          <p>Escolha o fuso usado para organizar suas movimentações.</p>
        </div>
        {loadState === 'loading' && (
          <p role="status">Carregando preferências…</p>
        )}
        {loadState === 'unauthorized' && (
          <p role="alert">
            Sua sessão expirou. <Link href="/entrar">Entre novamente</Link> para
            ver suas preferências.
          </p>
        )}
        {loadState === 'unavailable' && (
          <p role="alert">Não foi possível carregar suas preferências.</p>
        )}
        {loadState === 'ready' && (
          <form
            className="form-panel"
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <p className="account-note">Fuso atual: {current}.</p>
            <div className="field">
              <label htmlFor="time-zone">Fuso horário</label>
              <select
                id="time-zone"
                value={selected}
                onChange={(event) => {
                  setSelected(event.target.value);
                  setScope(null);
                  setSaveState('idle');
                }}
              >
                {options.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </div>
            {changed && (
              <fieldset className="field">
                <legend>
                  O que fazer com as movimentações já registradas?
                </legend>
                <label>
                  <input
                    type="radio"
                    name="time-zone-scope"
                    checked={scope === 'reinterpret_existing'}
                    onChange={() => {
                      setScope('reinterpret_existing');
                    }}
                  />{' '}
                  Reinterpretar as movimentações existentes no novo fuso
                </label>
                <label>
                  <input
                    type="radio"
                    name="time-zone-scope"
                    checked={scope === 'new_items_only'}
                    onChange={() => {
                      setScope('new_items_only');
                    }}
                  />{' '}
                  Aplicar o novo fuso somente às novas movimentações
                </label>
                <p className="field-note">
                  Os horários registrados não mudam. A escolha define em qual
                  dia cada movimentação aparece e fica registrada no histórico.
                </p>
              </fieldset>
            )}
            <button
              type="submit"
              disabled={!changed || scope === null || saveState === 'saving'}
            >
              {saveState === 'saving' ? 'Salvando…' : 'Salvar fuso'}
            </button>
            {saveState === 'saved' && (
              <p role="status" tabIndex={-1} ref={messageRef}>
                Fuso atualizado para {current}.
              </p>
            )}
            {saveMessages[saveState] !== undefined && (
              <p
                className="form-message error"
                role="alert"
                tabIndex={-1}
                ref={messageRef}
              >
                {saveMessages[saveState]}
              </p>
            )}
          </form>
        )}
        {loadState === 'ready' && children}
      </main>
    </div>
  );
}
