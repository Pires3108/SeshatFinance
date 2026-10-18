import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { ResetPasswordForm } from './reset-password-form';

export const metadata: Metadata = {
  title: 'Redefinir senha | Seshat Finance',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export default function ResetPasswordPage(): ReactNode {
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
          <h1 id="page-title">Crie uma nova senha.</h1>
          <p className="lead">
            Use o link recebido por e-mail para recuperar o acesso à sua conta.
          </p>
        </section>
        <ResetPasswordForm />
      </main>
    </div>
  );
}
