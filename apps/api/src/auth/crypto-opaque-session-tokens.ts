import { createHash, randomBytes } from 'node:crypto';

import type { OpaqueSessionTokenService } from '@seshat/application';

export class CryptoOpaqueSessionTokens implements OpaqueSessionTokenService {
  public generate(): string {
    return randomBytes(32).toString('base64url');
  }

  public hash(token: string): string {
    return createHash('sha256').update(token, 'utf8').digest('hex');
  }
}
