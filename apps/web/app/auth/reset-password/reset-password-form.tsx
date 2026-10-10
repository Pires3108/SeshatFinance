'use client';

import Link from 'next/link';
import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type SyntheticEvent,
} from 'react';

import { consumeRecoveryToken } from './consume-recovery-token';

type State =
  | 'loading'
  | 'ready'
  | 'submitting'
  | 'success'
  | 'invalid'
  | 'unavailable'
  | 'mismatch';

export function ResetPasswordForm(): ReactNode {
  const [state, setState] = useState<State>('loading');
  const tokenRef = useRef<string | null>(null);
  const started = useRef(false);
  const statusRef = useRef<HTMLDivElement>(null);

  useEffect((): void => {
    if (started.current) return;
    started.current = true;
    tokenRef.current = consumeRecoveryToken(
      window.location.href,
      (safeUrl): void => {
        window.history.replaceState(window.history.state, '', safeUrl);
      },
    );
    setState(tokenRef.current ? 'ready' : 'invalid');
  }, []);

  useEffect((): void => {
    if (state !== 'loading' && state !== 'ready' && state !== 'submitting') {
      statusRef.current?.focus();
    }
  }, [state]);

  async function submit(event: SyntheticEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const password = data.get('password');
    const confirmation = data.get('confirmation');
    if (password !== confirmation) {
      setState('mismatch');
      return;
    }
    const tokenHash = tokenRef.current;
    if (!tokenHash || typeof password !== 'string') {
      setState('invalid');
      return;
    }
    setState('submitting');
    try {
      const response = await fetch('/api/auth/password-recovery-completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tokenHash, password }),
      });
      if (response.status === 204) {
        tokenRef.current = null;
        form.reset();
        setState('success');
      } else if (response.status === 400) {
        tokenRef.current = null;
        form.reset();
        setState('invalid');
      } else {
        setState('unavailable');
      }
    } catch {
      setState('unavailable');
    }
  }

  return (
    <section
      className="form-panel"
      aria-labelledby="reset-title"
      aria-busy={state === 'loading' || state === 'submitting'}
    >
      <h2 id="reset-title">Redefinir senha</h2>
      {state === 'loading' && <p role="status">Preparando a redefinição…</p>}
      {state === 'success' && (
        <div
          className="success-panel"
          ref={statusRef}
          role="status"
          tabIndex={-1}
        >
          <strong>Senha redefinida.</strong>
          <p>Entre com sua nova senha para acessar a conta.</p>
          <Link href="/entrar">Ir para entrar</Link>
        </div>
      )}
      {state === 'invalid' && (
        <div ref={statusRef} role="alert" tabIndex={-1}>
          <p>Este link é inválido, expirou ou já foi usado.</p>
          <Link href="/recuperar-senha">Solicitar um novo link</Link>
        </div>
      )}
      {(state === 'ready' ||
        state === 'submitting' ||
        state === 'unavailable' ||
        state === 'mismatch') && (
        <form
          onSubmit={(event) => {
            void submit(event);
          }}
          aria-busy={state === 'submitting'}
        >
          <div className="field">
            <label htmlFor="new-password">Nova senha</label>
            <input
              id="new-password"
              name="password"
              type="password"
              autoComplete="new-password"
              maxLength={1024}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="confirm-password">Confirme a nova senha</label>
            <input
              id="confirm-password"
              name="confirmation"
              type="password"
              autoComplete="new-password"
              maxLength={1024}
              required
            />
          </div>
          <button
            className="primary-action"
            type="submit"
            disabled={state === 'submitting'}
          >
            {state === 'submitting' ? 'Salvando…' : 'Redefinir senha'}
          </button>
          {state === 'mismatch' && (
            <div
              className="form-message error"
              ref={statusRef}
              role="alert"
              tabIndex={-1}
            >
              As senhas não coincidem.
            </div>
          )}
          {state === 'unavailable' && (
            <div
              className="form-message error"
              ref={statusRef}
              role="alert"
              tabIndex={-1}
            >
              Não foi possível redefinir a senha agora. Tente novamente.
            </div>
          )}
        </form>
      )}
    </section>
  );
}
