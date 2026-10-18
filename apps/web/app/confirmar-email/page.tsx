import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { ConfirmationJourney } from './confirmation-journey';

export const metadata: Metadata = {
  title: 'Confirmar e-mail | Seshat Finance',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export default function ConfirmEmailPage(): ReactNode {
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
          <h1 id="page-title">Confirme seu e-mail.</h1>
          <p className="lead">
            Use o link enviado para concluir o cadastro da sua conta.
          </p>
        </section>
        <ConfirmationJourney />
      </main>
    </div>
  );
}
