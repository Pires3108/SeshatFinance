import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { BudgetManager } from './budget-manager';

export const metadata: Metadata = { title: 'Orçamentos | Seshat Finance' };

export default function BudgetsPage(): ReactNode {
  return <BudgetManager />;
}
