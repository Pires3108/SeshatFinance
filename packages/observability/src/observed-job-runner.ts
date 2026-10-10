import type {
  OperationCorrelationContext,
  JobCorrelationMetadata,
} from './correlation-context.js';
import { safeLogMetadata, type SafeLogSink } from './safe-log-metadata.js';

export class ObservedJobRunner {
  public constructor(
    private readonly context: OperationCorrelationContext,
    private readonly sink: SafeLogSink,
    private readonly monotonicTime: () => number = (): number =>
      performance.now(),
  ) {}

  public async run<Result>(
    metadata: JobCorrelationMetadata,
    handler: () => Promise<Result>,
  ): Promise<Result> {
    return this.context.run(
      this.context.resolveIdentifier(metadata.correlationId),
      async (): Promise<Result> => {
        const startedAt = this.monotonicTime();
        let succeeded = false;
        try {
          const result = await handler();
          succeeded = true;
          return result;
        } finally {
          this.sink(
            safeLogMetadata({
              action: succeeded ? 'job_completed' : 'job_failed',
              resourceType: 'job',
              outcome: succeeded ? 'success' : 'failure',
              durationMs: this.monotonicTime() - startedAt,
              correlationId: this.context.getCorrelationId() ?? 'unavailable',
            }),
          );
        }
      },
    );
  }
}
