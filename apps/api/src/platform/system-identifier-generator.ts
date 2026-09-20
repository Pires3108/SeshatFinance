import { randomUUID } from 'node:crypto';

import type { IdentifierGenerator } from '@seshat/application';

export class SystemIdentifierGenerator implements IdentifierGenerator {
  public generate(): string {
    return randomUUID();
  }
}
