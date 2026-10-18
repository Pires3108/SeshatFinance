/** Privacy-preserving observability adapters. */
export const observabilityPackage = '@seshat/observability' as const;
export {
  OperationCorrelationContext,
  isOpaqueCorrelationId,
  type JobCorrelationMetadata,
} from './correlation-context.js';
export {
  safeLogMetadata,
  type SafeLogEntry,
  type SafeLogSink,
} from './safe-log-metadata.js';
export { ObservedJobRunner } from './observed-job-runner.js';
