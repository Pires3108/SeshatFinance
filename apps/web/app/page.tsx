import type { ReactNode } from 'react';

export default function HomePage(): ReactNode {
  return (
    <main>
      <section aria-labelledby="page-title">
        <p className="eyebrow">Seshat Finance</p>
        <h1 id="page-title">Sua vida financeira, organizada.</h1>
        <p>Registre e acompanhe suas informações financeiras em um só lugar.</p>
        <p className="notice">
          A Seshat Finance não movimenta dinheiro nem executa transações
          externas.
        </p>
      </section>
    </main>
  );
}
