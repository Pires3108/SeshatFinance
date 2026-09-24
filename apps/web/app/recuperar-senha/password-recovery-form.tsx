'use client';

import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type SyntheticEvent,
} from 'react';

export function PasswordRecoveryForm(): ReactNode {
  const [state, setState] = useState<
    'idle' | 'submitting' | 'success' | 'error'
  >('idle');
  const errorRef = useRef<HTMLParagraphElement>(null);
  const successRef = useRef<HTMLDivElement>(null);

  useEffect((): void => {
    if (state === 'error') errorRef.current?.focus();
    if (state === 'success') successRef.current?.focus();
  }, [state]);

  async function submit(event: SyntheticEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setState('submitting');
    const email = new FormData(event.currentTarget).get('email');
    try {
      const response = await fetch('/api/auth/password-recovery-requests', {
        body: JSON.stringify({ email }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      });
      if (!response.ok) throw new Error('Recovery request unavailable.');
      setState('success');
    } catch {
      setState('error');
    }
  }

  return (
    <section className="form-panel" aria-labelledby="recovery-form-title">
      <h2 id="recovery-form-title">Recuperar senha</h2>
      {state === 'success' ? (
        <div
          className="success-panel"
          ref={successRef}
          role="status"
          tabIndex={-1}
        >
          <strong>Confira seu e-mail.</strong>
          <p>
            Se o endereço estiver cadastrado, você receberá instruções para
            redefinir a senha.
          </p>
        </div>
      ) : (
        <form
          aria-busy={state === 'submitting'}
          onSubmit={(event) => void submit(event)}
        >
          <div className="field">
            <label htmlFor="recovery-email">E-mail</label>
            <input
              id="recovery-email"
              name="email"
              type="email"
              autoComplete="email"
              maxLength={320}
              required
            />
          </div>
          <button
            className="primary-action"
            disabled={state === 'submitting'}
            type="submit"
          >
            {state === 'submitting' ? 'Enviando…' : 'Enviar instruções'}
          </button>
          {state === 'error' && (
            <p
              className="form-message error"
              ref={errorRef}
              role="alert"
              tabIndex={-1}
            >
              Não foi possível enviar a solicitação. Tente novamente.
            </p>
          )}
        </form>
      )}
    </section>
  );
}
