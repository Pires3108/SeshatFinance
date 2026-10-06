import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { AccountDetail } from './account-detail';

export const metadata: Metadata = {
  title: 'Detalhe da conta | Seshat Finance',
};

export default async function AccountDetailPage({
  params,
}: {
  params: Promise<{ accountId: string }>;
}): Promise<ReactNode> {
  const { accountId } = await params;
  return <AccountDetail accountId={accountId} />;
}
