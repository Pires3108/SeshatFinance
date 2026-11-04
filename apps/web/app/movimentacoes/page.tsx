import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { TemporalJournal } from './temporal-journal';

export const metadata: Metadata = { title: 'Visões temporais | Seshat Finance' };

export default function TemporalPage(): ReactNode {
  return <TemporalJournal />;
}
