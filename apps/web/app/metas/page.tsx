import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { GoalManager } from './goal-manager';

export const metadata: Metadata = { title: 'Metas | Seshat Finance' };

export default function GoalsPage(): ReactNode {
  return <GoalManager />;
}
