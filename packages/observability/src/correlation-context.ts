import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

const opaqueIdentifierPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export function isOpaqueCorrelationId(value: unknown): value is string {
  return typeof value === 'string' && opaqueIdentifierPattern.test(value);
}

export type JobCorrelationMetadata = Readonly<{ correlationId: string }>;

export class OperationCorrelationContext {
  private readonly storage = new AsyncLocalStorage<JobCorrelationMetadata>();

  public resolveIdentifier(value: unknown): string {
    return isOpaqueCorrelationId(value) ? value : randomUUID();
  }

  public run<Result>(correlationId: string, operation: () => Result): Result {
    return this.storage.run(
      { correlationId: this.resolveIdentifier(correlationId) },
      operation,
    );
  }

  public getCorrelationId(): string | undefined {
    return this.storage.getStore()?.correlationId;
  }

  public createJobMetadata(): JobCorrelationMetadata {
    return { correlationId: this.getCorrelationId() ?? randomUUID() };
  }
}
