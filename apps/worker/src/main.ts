import { AnonymizeDueCounterpartiesUseCase } from '@seshat/application';
import {
  PrismaCounterpartyRepository,
  createPrismaClient,
} from '@seshat/database';

import { createHealthServer } from './health-server.js';

const retentionCheckIntervalMs = 60 * 60 * 1000;

export async function bootstrap(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl === undefined || databaseUrl.length === 0)
    throw new Error('DATABASE_URL is required for counterparty retention.');

  const server = createHealthServer();
  const port = Number.parseInt(process.env.WORKER_PORT ?? '3002', 10);

  await new Promise<void>((resolve, reject): void => {
    server.once('error', reject);
    server.listen(port, '0.0.0.0', resolve);
  });

  const prisma = createPrismaClient(databaseUrl);
  const retention = new AnonymizeDueCounterpartiesUseCase(
    new PrismaCounterpartyRepository(prisma),
    { now: (): Date => new Date() },
  );
  let running = false;
  const checkRetention = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      await retention.execute();
    } catch {
      process.stderr.write('Counterparty retention check failed.\n');
    } finally {
      running = false;
    }
  };
  void checkRetention();
  const interval = setInterval((): void => {
    void checkRetention();
  }, retentionCheckIntervalMs);

  const shutdown = (): void => {
    clearInterval(interval);
    server.close((error): void => {
      process.exitCode = error === undefined ? 0 : 1;
      void prisma.$disconnect();
    });
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

if (process.env.NODE_ENV !== 'test') {
  await bootstrap();
}
