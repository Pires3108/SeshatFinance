import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { AccountList } from './account-list';

export const metadata: Metadata = { title: 'Contas | Seshat Finance' };

export default function AccountsPage(): ReactNode {
  return <AccountList />;
}
