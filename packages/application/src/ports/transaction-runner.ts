export interface TransactionRunner {
  run<Result>(operation: () => Promise<Result>): Promise<Result>;
}
