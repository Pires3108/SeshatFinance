'use client';

import { useState, type ReactNode, type SyntheticEvent } from 'react';

export function RegistrationForm(): ReactNode {
  const [state, setState] = useState<
    'idle' | 'submitting' | 'success' | 'error'
  >('idle');

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
        setState('error');
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
        <div className="success-panel" role="status">
          <strong>Confira seu e-mail.</strong>
          <p>
            Se o cadastro foi recebido, você encontrará uma mensagem com as
            instruções de confirmação.
          </p>
        </div>
      ) : (
        <>
          <p>Todos os campos são obrigatórios.</p>
          <form
            onSubmit={(event) => {
              void handleSubmit(event);
            }}
          >
            <div className="field">
              <label htmlFor="display-name">Nome</label>
              <input
                id="display-name"
                name="displayName"
                autoComplete="name"
                maxLength={120}
                required
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
              />
            </div>
            <div className="field">
              <label htmlFor="password">Senha</label>
              <input
                id="password"
                name="password"
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
              {state === 'submitting' ? 'Enviando…' : 'Criar conta'}
            </button>
            {state === 'error' && (
              <p className="form-message error" role="alert">
                Não foi possível enviar o cadastro. Confira os dados e tente
                novamente.
              </p>
            )}
          </form>
        </>
      )}
    </section>
  );
}
