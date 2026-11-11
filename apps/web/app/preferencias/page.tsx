import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { TimeZoneForm } from './time-zone-form';

export const metadata: Metadata = {
  title: 'Preferências | Seshat Finance',
};

export default function PreferencesPage(): ReactNode {
  return <TimeZoneForm />;
}
