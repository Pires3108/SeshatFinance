import type { ReactNode } from 'react';
import Link from 'next/link';

export default function HomePage(): ReactNode {
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
        <Link href="/cadastro">Criar conta</Link>
      </header>
      <main className="page-grid" id="main-content" tabIndex={-1}>
        <section className="intro" aria-labelledby="page-title">
          <span className="section-label">Clareza para suas finanças</span>
          <h1 id="page-title">Um lugar para entender seu dinheiro.</h1>
          <p className="lead">
            Organize contas, movimentações e objetivos em um registro que você
            controla.
          </p>
          <p className="boundary">
            <strong>Seus dados, sem movimentações.</strong> A Seshat Finance
            registra informações financeiras; ela não executa transações
            externas.
          </p>
        </section>
        <section className="form-panel" aria-labelledby="start-title">
          <h2 id="start-title">Comece pelo cadastro</h2>
          <p>
            Crie sua conta e confirme seu e-mail. O acesso aos registros virá em
            uma próxima etapa.
          </p>
          <Link
            className="primary-action"
            href="/cadastro"
            style={{
              display: 'grid',
              placeItems: 'center',
              textDecoration: 'none',
            }}
          >
            Criar conta
          </Link>
        </section>
      </main>
    </div>
  );
}
