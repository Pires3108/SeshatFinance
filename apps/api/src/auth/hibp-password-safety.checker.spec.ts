import { createHash } from 'node:crypto';

import { PasswordCheckUnavailableError } from '@seshat/application';
import { describe, expect, it, vi } from 'vitest';

import { HibpPasswordSafetyChecker } from './hibp-password-safety.checker.js';

const password = 'synthetic-test-password-123';
const hash = createHash('sha1')
  .update(password, 'utf8')
  .digest('hex')
  .toUpperCase();

describe('HibpPasswordSafetyChecker', () => {
  it('sends only the first five SHA-1 characters with padding and identifies a compromised password', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue({
      status: 200,
      text: () =>
        Promise.resolve(`${hash.slice(5)}:12\r\n${'A'.repeat(35)}:0\r\n`),
    } as Response);
    const checker = new HibpPasswordSafetyChecker(request);
    await expect(checker.isCompromised(password)).resolves.toBe(true);
    expect(request).toHaveBeenCalledWith(
      `https://api.pwnedpasswords.com/range/${hash.slice(0, 5)}`,
      expect.objectContaining({
        method: 'GET',
        headers: {
          'Add-Padding': 'true',
          'User-Agent': 'SeshatFinance-PasswordSafety/1.0',
        },
      }),
    );
    expect(JSON.stringify(request.mock.calls)).not.toContain(password);
    expect(JSON.stringify(request.mock.calls)).not.toContain(hash.slice(5));
  });

  it('ignores padded zero-count matches', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue({
      status: 200,
      text: () => Promise.resolve(`${hash.slice(5)}:0\r\n`),
    } as Response);
    await expect(
      new HibpPasswordSafetyChecker(request).isCompromised(password),
    ).resolves.toBe(false);
  });

  it('fails closed on outage or malformed range response without leaking the password', async () => {
    const responses = [
      { status: 503, text: () => Promise.resolve('unavailable') },
      { status: 200, text: () => Promise.resolve('bad response') },
      { status: 200, text: () => Promise.resolve('\r\n') },
    ];
    for (const response of responses) {
      const checker = new HibpPasswordSafetyChecker(
        vi.fn<typeof fetch>().mockResolvedValue(response as Response),
      );
      await expect(checker.isCompromised(password)).rejects.toBeInstanceOf(
        PasswordCheckUnavailableError,
      );
    }
  });
});
