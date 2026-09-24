'use client';

import { useEffect, type ReactNode } from 'react';

export function PwaRegistration(): ReactNode {
  useEffect((): void => {
    if ('serviceWorker' in navigator) {
      void navigator.serviceWorker.register('/service-worker.js');
    }
  }, []);
  return null;
}
