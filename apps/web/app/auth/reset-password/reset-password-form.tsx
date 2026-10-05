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
  'loading' | 'ready' | 'submitting' | 'success' | 'error' | 'invalid';

export function ResetPasswordForm(): ReactNode {
  const [state, setState] = useState<State>('loading');
  const tokenHash = useRef<string | null>(null);
  const messageRef = useRef<HTMLParagraphElement>(null);

  useEffect((): void => {
    if (tokenHash.current !== null) return;
    const fragment = new URLSearchParams(window.location.hash.slice(1));
    const token = fragment.get('token_hash');
    tokenHash.current = token !== null && token.length <= 512 ? token : null;
    window.history.replaceState(null, '', window.location.pathname);
    setState(tokenHash.current === null ? 'invalid' : 'ready');
  }, []);

  useEffect((): void => {
    if (state === 'error' || state === 'invalid' || state === 'success')
      messageRef.current?.focus();
  }, [state]);

  async function submit(event: SyntheticEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const token = tokenHash.current;
    if (token === null) {
      setState('invalid');
      return;
    }
    const form = event.currentTarget;
    const password = new FormData(form).get('password');
    setState('submitting');
    try {
      const response = await fetch('/api/auth/password-recovery-completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tokenHash: token, password }),
      });
      if (response.status === 400) {
        tokenHash.current = null;
        setState('invalid');
        return;
      }
      if (!response.ok) {
        setState('error');
        return;
      }
      tokenHash.current = null;
      form.reset();
      setState('success');
    } catch {
      setState('error');
    }
  }

  return (
    <section className="form-panel" aria-labelledby="reset-form-title">
      <h2 id="reset-form-title">Escolha uma nova senha</h2>
      {state === 'loading' && <p role="status">Verificando link…</p>}
      {state === 'ready' || state === 'submitting' || state === 'error' ? (
        <form
          aria-busy={state === 'submitting'}
          onSubmit={(event) => void submit(event)}
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
          <button
            className="primary-action"
            disabled={state === 'submitting'}
            type="submit"
          >
            {state === 'submitting' ? 'Salvando…' : 'Redefinir senha'}
          </button>
          {state === 'error' && (
            <p
              className="form-message error"
              ref={messageRef}
              role="alert"
              tabIndex={-1}
            >
              Não foi possível redefinir a senha. Tente novamente.
            </p>
          )}
        </form>
      ) : null}
      {state === 'invalid' && (
        <p
          className="form-message error"
          ref={messageRef}
          role="alert"
          tabIndex={-1}
        >
          O link é inválido ou expirou.{' '}
          <Link href="/recuperar-senha">Solicite um novo link.</Link>
        </p>
      )}
      {state === 'success' && (
        <p
          className="form-message"
          ref={messageRef}
          role="status"
          tabIndex={-1}
        >
          Senha redefinida. <Link href="/entrar">Entrar</Link>
        </p>
      )}
    </section>
  );
}
