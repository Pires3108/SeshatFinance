import { describe, expect, it, vi } from 'vitest';

import { consumeRecoveryToken } from './consume-recovery-token';

describe('recovery callback URL', () => {
  it('removes the entire fragment before returning the token', () => {
    const replaceUrl = vi.fn();
    expect(
      consumeRecoveryToken(
        'https://app.test/auth/reset-password#token_hash=secret-token&type=recovery',
        replaceUrl,
      ),
    ).toBe('secret-token');
    expect(replaceUrl).toHaveBeenCalledWith('/auth/reset-password');
  });

  it('rejects a missing or malformed token', () => {
    const replaceUrl = vi.fn();
    expect(
      consumeRecoveryToken(
        'https://app.test/auth/reset-password#access_token=secret',
        replaceUrl,
      ),
    ).toBeNull();
    expect(
      consumeRecoveryToken(
        'https://app.test/auth/reset-password#token_hash=%20',
        replaceUrl,
      ),
    ).toBeNull();
    expect(replaceUrl).toHaveBeenCalledTimes(2);
  });
});
