import type { ReactNode } from 'react';

export default function OfflinePage(): ReactNode {
  return (
    <main className="offline-page" id="main-content" tabIndex={-1}>
      <h1>Você está sem conexão.</h1>
      <p>Reconecte-se à internet para consultar ou registrar informações.</p>
    </main>
  );
}
