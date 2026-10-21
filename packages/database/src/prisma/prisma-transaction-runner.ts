import { AsyncLocalStorage } from 'node:async_hooks';

import type { TransactionRunner } from '@seshat/application';

import type { Prisma, PrismaClient } from '../generated/prisma/client.js';

/** Keeps the ORM transaction context inside Infrastructure. */
export class PrismaTransactionRunner implements TransactionRunner {
  private readonly scope = new AsyncLocalStorage<Prisma.TransactionClient>();

  public constructor(private readonly client: PrismaClient) {}

  public get transactionClient(): Prisma.TransactionClient {
    const client = this.scope.getStore();
    if (client === undefined) {
      throw new Error('A transaction scope is required.');
    }
    return client;
  }

  public async run<Result>(operation: () => Promise<Result>): Promise<Result> {
    if (this.scope.getStore() !== undefined) {
      throw new Error('Nested transaction scopes are not supported.');
    }
    return this.client.$transaction((client) =>
      this.scope.run(client, operation),
    );
  }
}
