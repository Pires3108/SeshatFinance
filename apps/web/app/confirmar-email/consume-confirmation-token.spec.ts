import { describe, expect, it, vi } from 'vitest';
import { consumeConfirmationToken } from './consume-confirmation-token';

describe('confirmation callback URL', () => {
  it('removes the token from the URL before submission', () => {
    const replaceUrl = vi.fn();
    expect(
      consumeConfirmationToken(
        'http://localhost:3000/confirmar-email?source=email#token_hash=secret-token',
        replaceUrl,
      ),
    ).toBe('secret-token');
    expect(replaceUrl).toHaveBeenCalledWith('/confirmar-email?source=email');
  });

  it('handles a missing token', () => {
    const replaceUrl = vi.fn();
    expect(
      consumeConfirmationToken(
        'http://localhost:3000/confirmar-email',
        replaceUrl,
      ),
    ).toBeNull();
    expect(replaceUrl).toHaveBeenCalledWith('/confirmar-email');
  });
});
