import { AsyncLocalStorage } from 'node:async_hooks';

import { Injectable } from '@nestjs/common';

type CorrelationStore = Readonly<{ correlationId: string }>;

@Injectable()
export class CorrelationContext {
  private readonly storage = new AsyncLocalStorage<CorrelationStore>();
  private readonly requestIdentifiers = new WeakMap<object, string>();

  public run<Result>(correlationId: string, operation: () => Result): Result {
    return this.storage.run({ correlationId }, operation);
  }

  public getCorrelationId(): string | undefined {
    return this.storage.getStore()?.correlationId;
  }

  public associateRequest(request: object, correlationId: string): void {
    this.requestIdentifiers.set(request, correlationId);
  }

  public getRequestCorrelationId(request: object): string | undefined {
    return this.requestIdentifiers.get(request);
  }
}
