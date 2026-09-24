import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { RegistrationForm } from './registration-form';

export const metadata: Metadata = {
  title: 'Cadastro | Seshat Finance',
};

export default function RegistrationPage(): ReactNode {
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
          <h1 id="page-title">Comece com um registro claro.</h1>
          <p className="lead">
            Informe seus dados para criar sua conta. Enviaremos uma mensagem
            para confirmar seu e-mail.
          </p>
          <p className="boundary">
            <strong>Somente informações.</strong> O cadastro não autoriza nem
            movimenta dinheiro.
          </p>
        </section>
        <RegistrationForm />
      </main>
    </div>
  );
}
