import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { HolidaySettingsForm } from './holiday-settings-form';
import { RefundPresentationForm } from './refund-presentation-form';
import { TimeZoneForm } from './time-zone-form';

export const metadata: Metadata = {
  title: 'Preferências | Seshat Finance',
};

export default function PreferencesPage(): ReactNode {
  return (
    <TimeZoneForm>
      <RefundPresentationForm />
      <HolidaySettingsForm />
    </TimeZoneForm>
  );
}
