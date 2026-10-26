import { afterEach, expect, it, vi } from 'vitest';

import { bootstrap } from './main.js';

afterEach((): void => {
  vi.unstubAllEnvs();
});

it('refuses to report a healthy worker without retention database configuration', async (): Promise<void> => {
  vi.stubEnv('DATABASE_URL', '');
  await expect(bootstrap()).rejects.toThrow(
    'DATABASE_URL is required for counterparty retention.',
  );
});
