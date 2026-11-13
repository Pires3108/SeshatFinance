import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { CardManager } from './card-manager';

export const metadata: Metadata = { title: 'Cartões | Seshat Finance' };

export default function CardsPage(): ReactNode {
  return <CardManager />;
}
