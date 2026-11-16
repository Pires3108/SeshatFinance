import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { LoanManager } from './loan-manager';

export const metadata: Metadata = { title: 'Empréstimos | Seshat Finance' };

export default function LoansPage(): ReactNode {
  return <LoanManager />;
}
