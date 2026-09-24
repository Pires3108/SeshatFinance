import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import './styles.css';
import { PwaRegistration } from './pwa-registration';

export const metadata: Metadata = {
  description: 'Organize suas informações financeiras com clareza.',
  title: 'Seshat Finance',
};

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>): ReactNode {
  return (
    <html lang="pt-BR">
      <body>
        <PwaRegistration />
        {children}
      </body>
    </html>
  );
}
