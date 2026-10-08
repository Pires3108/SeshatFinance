import { OperationCorrelationContext } from '@seshat/observability';

import { Injectable } from '@nestjs/common';

@Injectable()
export class CorrelationContext extends OperationCorrelationContext {
  private readonly requestIdentifiers = new WeakMap<object, string>();
  private readonly requestStarts = new WeakMap<object, number>();

  public associateRequest(request: object, correlationId: string): void {
    this.requestIdentifiers.set(request, correlationId);
    this.requestStarts.set(request, performance.now());
  }

  public getRequestCorrelationId(request: object): string | undefined {
    return this.requestIdentifiers.get(request);
  }

  public getRequestDuration(request: object): number {
    return (
      performance.now() - (this.requestStarts.get(request) ?? performance.now())
    );
  }
}
