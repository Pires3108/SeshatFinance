import { createHealthServer } from './health-server.js';

export async function bootstrap(): Promise<void> {
  const server = createHealthServer();
  const port = Number.parseInt(process.env.WORKER_PORT ?? '3002', 10);

  await new Promise<void>((resolve, reject): void => {
    server.once('error', reject);
    server.listen(port, '0.0.0.0', resolve);
  });

  const shutdown = (): void => {
    server.close((error): void => {
      process.exitCode = error === undefined ? 0 : 1;
    });
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

if (process.env.NODE_ENV !== 'test') {
  await bootstrap();
}
