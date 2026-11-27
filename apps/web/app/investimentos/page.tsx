import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { InvestmentManager } from './investment-manager';

export const metadata: Metadata = { title: 'Investimentos | Seshat Finance' };

export default function InvestmentsPage(): ReactNode {
  return <InvestmentManager />;
}
