import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { TransactionJournal } from './transaction-journal';

export const metadata: Metadata = { title: 'Movimentações | Seshat Finance' };

export default async function TransactionsPage({
  params,
}: {
  params: Promise<{ accountId: string }>;
}): Promise<ReactNode> {
  const { accountId } = await params;
  return <TransactionJournal accountId={accountId} />;
}
