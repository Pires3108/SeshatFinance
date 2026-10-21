import {
  ObservedJobRunner,
  OperationCorrelationContext,
  type JobCorrelationMetadata,
  type SafeLogSink,
} from '@seshat/observability';

export class WorkerJobRunner {
  public readonly context = new OperationCorrelationContext();
  private readonly runner: ObservedJobRunner;

  public constructor(
    sink: SafeLogSink = (entry): void => {
      process.stdout.write(
        `${JSON.stringify({ service: 'worker', ...entry })}\n`,
      );
    },
  ) {
    this.runner = new ObservedJobRunner(this.context, sink);
  }

  public async run<Result>(
    metadata: JobCorrelationMetadata,
    handler: () => Promise<Result>,
  ): Promise<Result> {
    return this.runner.run(metadata, handler);
  }
}
