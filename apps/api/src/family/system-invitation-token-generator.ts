import { createHash, randomBytes } from 'node:crypto';
import type { InvitationTokenGenerator } from '@seshat/application';

export class SystemInvitationTokenGenerator implements InvitationTokenGenerator {
  public generate(): { token: string; hash: string } {
    const token = randomBytes(32).toString('base64url');
    return {
      token,
      hash: createHash('sha256').update(token, 'utf8').digest('hex'),
    };
  }
}

export function hashInvitationToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}
