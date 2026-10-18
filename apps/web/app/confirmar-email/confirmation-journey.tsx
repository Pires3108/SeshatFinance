'use client';

import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type SyntheticEvent,
} from 'react';
import Link from 'next/link';
import { consumeConfirmationToken } from './consume-confirmation-token';

type ConfirmationState =
  'loading' | 'success' | 'invalid' | 'unavailable' | 'missing';

export function ConfirmationJourney(): ReactNode {
  const [state, setState] = useState<ConfirmationState>('loading');
  const [resendState, setResendState] = useState<
    'idle' | 'sending' | 'sent' | 'error'
  >('idle');
  const statusRef = useRef<HTMLDivElement>(null);
  const started = useRef(false);

  useEffect((): void => {
    if (started.current) return;
    started.current = true;
    const tokenHash = consumeConfirmationToken(
      window.location.href,
      (safeUrl): void => {
        window.history.replaceState(window.history.state, '', safeUrl);
      },
    );
    if (!tokenHash) {
      setState('missing');
      return;
    }
    void (async (): Promise<void> => {
      try {
        const response = await fetch('/api/auth/registrations/confirm', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tokenHash }),
        });
        setState(
          response.status === 204
            ? 'success'
            : response.status === 400
              ? 'invalid'
              : 'unavailable',
        );
      } catch {
        setState('unavailable');
      }
    })();
  }, []);

  useEffect((): void => {
    if (state !== 'loading') statusRef.current?.focus();
  }, [state]);

  async function handleResend(
    event: SyntheticEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    const form = event.currentTarget;
    const email = new FormData(form).get('email');
    setResendState('sending');
    try {
      const response = await fetch('/api/auth/registrations/resend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      if (response.status !== 202) {
        setResendState('error');
        return;
      }
      form.reset();
      setResendState('sent');
    } catch {
      setResendState('error');
    }
  }

  return (
    <section
      className="form-panel"
      aria-labelledby="confirmation-title"
      aria-busy={state === 'loading'}
    >
      <h2 id="confirmation-title">Confirmação de cadastro</h2>
      <div ref={statusRef} role="status" tabIndex={-1}>
        {state === 'loading' && <p>Confirmando seu e-mail…</p>}
        {state === 'success' && (
          <div className="success-panel">
            <strong>E-mail confirmado.</strong>
            <p>Seu cadastro foi concluído.</p>
            <Link href="/">Ir para o início</Link>
          </div>
        )}
        {state === 'invalid' && (
          <p>
            Este link é inválido, expirou ou já foi usado. Solicite um novo
            e-mail de confirmação.
          </p>
        )}
        {state === 'missing' && (
          <p>
            O link de confirmação está incompleto. Solicite um novo e-mail de
            confirmação.
          </p>
        )}
        {state === 'unavailable' && (
          <p>
            Não foi possível confirmar seu e-mail agora. Tente abrir o link
            novamente mais tarde.
          </p>
        )}
      </div>
      {(state === 'invalid' || state === 'missing') && (
        <form
          onSubmit={(event) => {
            void handleResend(event);
          }}
          aria-busy={resendState === 'sending'}
        >
          <p>Informe o e-mail usado no cadastro para receber um novo link.</p>
          <div className="field">
            <label htmlFor="resend-email">E-mail</label>
            <input
              id="resend-email"
              name="email"
              type="email"
              autoComplete="email"
              maxLength={320}
              required
            />
          </div>
          <button
            className="primary-action"
            type="submit"
            disabled={resendState === 'sending'}
          >
            {resendState === 'sending' ? 'Enviando…' : 'Enviar novo link'}
          </button>
          {resendState === 'sent' && (
            <p className="form-message" role="status">
              Se o cadastro estiver pendente, enviaremos um novo link para esse
              e-mail.
            </p>
          )}
          {resendState === 'error' && (
            <p className="form-message error" role="alert">
              Não foi possível enviar um novo link. Tente novamente mais tarde.
            </p>
          )}
        </form>
      )}
    </section>
  );
}
