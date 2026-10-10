'use client';

import Link from 'next/link';
import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type SyntheticEvent,
} from 'react';

type State =
  | 'checking'
  | 'idle'
  | 'submitting'
  | 'authenticated'
  | 'logging-out'
  | 'logout-error'
  | 'error';

export function LoginForm(): ReactNode {
  const [state, setState] = useState<State>('checking');
  const errorRef = useRef<HTMLParagraphElement>(null);
  const statusRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void fetch('/api/auth/sessions', { cache: 'no-store' })
      .then((response) => {
        setState(response.ok ? 'authenticated' : 'idle');
      })
      .catch(() => {
        setState('idle');
      });
  }, []);

  useEffect(() => {
    if (state === 'error' || state === 'logout-error')
      errorRef.current?.focus();
    if (state === 'authenticated') statusRef.current?.focus();
  }, [state]);

  async function login(event: SyntheticEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setState('submitting');
    try {
      const response = await fetch('/api/auth/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: data.get('email'),
          password: data.get('password'),
        }),
      });
      if (!response.ok) {
        setState('error');
        return;
      }
      form.reset();
      setState('authenticated');
    } catch {
      setState('error');
    }
  }

  async function logout(): Promise<void> {
    setState('logging-out');
    try {
      const response = await fetch('/api/auth/sessions', { method: 'DELETE' });
      setState(response.ok ? 'idle' : 'logout-error');
    } catch {
      setState('logout-error');
    }
  }

  return (
    <section className="form-panel" aria-labelledby="form-title">
      <h2 id="form-title">Entrar</h2>
      {state === 'checking' && <p role="status">Verificando sessão…</p>}
      {state === 'authenticated' ||
      state === 'logging-out' ||
      state === 'logout-error' ? (
        <div
          className="success-panel"
          ref={statusRef}
          role="status"
          tabIndex={-1}
        >
          <strong>Sessão ativa.</strong>
          <p>Você entrou na Seshat Finance.</p>
          <button
            className="primary-action"
            type="button"
            disabled={state === 'logging-out'}
            onClick={() => {
              void logout();
            }}
          >
            {state === 'logging-out' ? 'Saindo…' : 'Sair'}
          </button>
          {state === 'logout-error' && (
            <p
              className="form-message error"
              ref={errorRef}
              role="alert"
              tabIndex={-1}
            >
              Não foi possível sair. Tente novamente.
            </p>
          )}
        </div>
      ) : (
        state !== 'checking' && (
          <>
            <form
              aria-busy={state === 'submitting'}
              onSubmit={(event) => {
                void login(event);
              }}
            >
              <div className="field">
                <label htmlFor="login-email">E-mail</label>
                <input
                  id="login-email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  maxLength={320}
                  required
                />
              </div>
              <div className="field">
                <label htmlFor="login-password">Senha</label>
                <input
                  id="login-password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  maxLength={1024}
                  required
                />
              </div>
              <button
                className="primary-action"
                type="submit"
                disabled={state === 'submitting'}
              >
                {state === 'submitting' ? 'Entrando…' : 'Entrar'}
              </button>
              {state === 'error' && (
                <p
                  className="form-message error"
                  ref={errorRef}
                  role="alert"
                  tabIndex={-1}
                >
                  Não foi possível entrar. Confira os dados e tente novamente.
                </p>
              )}
            </form>
            <p className="form-message">
              <Link href="/recuperar-senha">Esqueceu sua senha?</Link>
            </p>
          </>
        )
      )}
    </section>
  );
}
