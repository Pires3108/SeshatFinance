import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

/**
 * @param {NodeJS.ProcessEnv} environment
 * @param {(command: string, args: string[], environment: NodeJS.ProcessEnv) => number} run
 * @returns {void}
 */
export function bootstrapLocalDatabase(environment, run) {
  const port = environment.POSTGRES_PORT ?? '5432';
  if (!/^[1-9]\d{0,4}$/u.test(port) || Number(port) > 65535) {
    throw new Error('POSTGRES_PORT must be an integer between 1 and 65535.');
  }
  const childEnvironment = {
    ...environment,
    POSTGRES_PORT: port,
    DATABASE_URL:
      environment.DATABASE_URL ??
      `postgresql://seshat:seshat@localhost:${port}/seshat?schema=public`,
  };
  const databaseUrl = new URL(childEnvironment.DATABASE_URL);
  if (
    !['localhost', '127.0.0.1'].includes(databaseUrl.hostname) ||
    databaseUrl.port !== port ||
    databaseUrl.pathname !== '/seshat' ||
    databaseUrl.username !== 'seshat' ||
    databaseUrl.password !== 'seshat'
  ) {
    throw new Error(
      'DATABASE_URL must target the synthetic local Compose database on POSTGRES_PORT.',
    );
  }
  /** @type {Array<[string, string[]]>} */
  const commands = [
    [
      'docker',
      [
        'compose',
        'up',
        '--detach',
        '--wait',
        '--wait-timeout',
        '120',
        'postgres',
      ],
    ],
    [
      'pnpm',
      [
        '--filter',
        '@seshat/database',
        'exec',
        'prisma',
        'generate',
        '--config',
        'prisma7.config.ts',
      ],
    ],
    [
      'pnpm',
      [
        '--filter',
        '@seshat/database',
        'exec',
        'prisma',
        'migrate',
        'deploy',
        '--config',
        'prisma7.config.ts',
      ],
    ],
    ['pnpm', ['--filter', '@seshat/database', 'db:seed']],
  ];
  for (const [command, args] of commands) {
    if (run(command, args, childEnvironment) !== 0) {
      throw new Error(
        'Local database bootstrap failed. Later steps were not run.',
      );
    }
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    bootstrapLocalDatabase(process.env, (command, args, env) => {
      const result = spawnSync(command, args, {
        env,
        stdio: 'inherit',
        shell: process.platform === 'win32',
      });
      return result.status ?? 1;
    });
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : 'Local bootstrap failed.',
    );
    process.exitCode = 1;
  }
}
