import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { PasswordRecoveryForm } from './password-recovery-form';

export const metadata: Metadata = { title: 'Recuperar senha | Seshat Finance' };

export default function PasswordRecoveryPage(): ReactNode {
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
          <span className="section-label">Acesso à conta</span>
          <h1 id="page-title">Vamos ajudar você a recuperar o acesso.</h1>
          <p className="lead">
            Informe seu e-mail para receber instruções, se houver uma conta
            associada a ele.
          </p>
        </section>
        <PasswordRecoveryForm />
      </main>
    </div>
  );
}
