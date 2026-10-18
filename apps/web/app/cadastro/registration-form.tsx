'use client';

import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type SyntheticEvent,
} from 'react';

export function RegistrationForm(): ReactNode {
  const [state, setState] = useState<
    'idle' | 'submitting' | 'success' | 'error' | 'password-rejected'
  >('idle');
  const errorRef = useRef<HTMLParagraphElement>(null);
  const successRef = useRef<HTMLDivElement>(null);

  useEffect((): void => {
    if (state === 'error' || state === 'password-rejected')
      errorRef.current?.focus();
    if (state === 'success') successRef.current?.focus();
  }, [state]);

  async function handleSubmit(
    event: SyntheticEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    setState('submitting');
    const form = event.currentTarget;
    const data = new FormData(form);
    try {
      const response = await fetch('/api/auth/registrations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          displayName: data.get('displayName'),
          email: data.get('email'),
          password: data.get('password'),
        }),
      });
      if (!response.ok) {
        setState(response.status === 422 ? 'password-rejected' : 'error');
        return;
      }
      form.reset();
      setState('success');
    } catch {
      setState('error');
    }
  }

  return (
    <section className="form-panel" aria-labelledby="form-title">
      <h2 id="form-title">Criar conta</h2>
      {state === 'success' ? (
        <div
          className="success-panel"
          ref={successRef}
          role="status"
          tabIndex={-1}
        >
          <strong>Confira seu e-mail.</strong>
          <p>
            Se o cadastro foi recebido, você encontrará uma mensagem com as
            instruções de confirmação.
          </p>
        </div>
      ) : (
        <>
          <p id="registration-instructions">
            Todos os campos são obrigatórios.
          </p>
          <form
            aria-busy={state === 'submitting'}
            aria-describedby="registration-instructions"
            onSubmit={(event) => {
              void handleSubmit(event);
            }}
          >
            {state === 'submitting' && (
              <p className="form-message" role="status">
                Enviando cadastro…
              </p>
            )}
            <div className="field">
              <label htmlFor="display-name">Nome</label>
              <input
                id="display-name"
                name="displayName"
                autoComplete="name"
                maxLength={120}
                required
                aria-describedby="registration-instructions"
              />
            </div>
            <div className="field">
              <label htmlFor="email">E-mail</label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                maxLength={320}
                required
                aria-describedby="registration-instructions"
              />
            </div>
            <div className="field">
              <label htmlFor="password">Senha</label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="new-password"
                minLength={12}
                maxLength={1024}
                required
                aria-describedby="registration-instructions password-instructions"
              />
              <span className="field-note" id="password-instructions">
                Use pelo menos 12 caracteres. Evite senhas expostas em
                vazamentos de dados.
              </span>
            </div>
            <button
              className="primary-action"
              type="submit"
              disabled={state === 'submitting'}
            >
              {state === 'submitting' ? 'Enviando…' : 'Criar conta'}
            </button>
            {state === 'error' && (
              <p
                className="form-message error"
                ref={errorRef}
                role="alert"
                tabIndex={-1}
              >
                Não foi possível enviar o cadastro. Confira os dados e tente
                novamente.
              </p>
            )}
            {state === 'password-rejected' && (
              <p
                className="form-message error"
                ref={errorRef}
                role="alert"
                tabIndex={-1}
              >
                Esta senha não pode ser usada. Escolha outra senha com pelo
                menos 12 caracteres.
              </p>
            )}
          </form>
        </>
      )}
    </section>
  );
}
