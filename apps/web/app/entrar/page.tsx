import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { LoginForm } from './login-form';

export const metadata: Metadata = { title: 'Entrar | Seshat Finance' };

export default function LoginPage(): ReactNode {
  return (
    <div className="site-shell">
      <a className="skip-link" href="#main-content">
        Pular para o conteúdo
      </a>
      <header className="site-header">
        <Link className="brand" href="/">
          <span className="brand-mark" aria-hidden="true" />
          Seshat Finance
        </Link>
      </header>
      <main className="page-grid" id="main-content" tabIndex={-1}>
        <section className="intro" aria-labelledby="page-title">
          <span className="section-label">Sua conta</span>
          <h1 id="page-title">Acesse seus registros.</h1>
          <p className="lead">Entre com o e-mail confirmado e sua senha.</p>
          <p className="boundary">
            <strong>Somente informações.</strong> O acesso não autoriza nem
            movimenta dinheiro.
          </p>
        </section>
        <LoginForm />
      </main>
    </div>
  );
}
