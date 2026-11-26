import { spawn, type ChildProcess } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';

import { expect, test, type APIRequestContext } from '@playwright/test';
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { Client } from 'pg';

import { acquireSharedApiPort, stopApi } from './support/shared-api-port';

const apiUrl = 'http://localhost:3101';
const token = randomBytes(32).toString('base64url');
const cookie = `__Host-seshat_session=${token}`;
const userId = randomUUID();
let container: StartedPostgreSqlContainer | undefined;
let api: ChildProcess | undefined;
let releaseApiPort: (() => Promise<void>) | undefined;

test.beforeAll(async (): Promise<void> => {
  test.setTimeout(660_000);
  releaseApiPort = await acquireSharedApiPort();
  container = await new PostgreSqlContainer('postgres:17-alpine').start();
  const client = new Client({ connectionString: container.getConnectionUri() });
  await client.connect();
  try {
    const migrations = resolve(
      process.cwd(),
      '../../packages/database/prisma/migrations',
    );
    for (const directory of (await readdir(migrations)).sort()) {
      if (/^\d/u.test(directory)) {
        await client.query(
          await readFile(
            resolve(migrations, directory, 'migration.sql'),
            'utf8',
          ),
        );
      }
    }
    await client.query(
      'INSERT INTO user_sessions (id, user_id, token_hash, created_at, last_seen_at) VALUES ($1, $2, $3, now(), now())',
      [randomUUID(), userId, createHash('sha256').update(token).digest('hex')],
    );
    await client.query(
      'INSERT INTO user_profiles (id, updated_at) VALUES ($1, now())',
      [userId],
    );
  } finally {
    await client.end();
  }
  api = spawn(
    process.execPath,
    [resolve(process.cwd(), '../api/dist/main.js')],
    {
      env: {
        ...process.env,
        API_PORT: '3101',
        DATABASE_URL: container.getConnectionUri(),
      },
      stdio: 'ignore',
      windowsHide: true,
    },
  );
  await expect
    .poll(
      async () => {
        if (api?.exitCode !== null)
          throw new Error('API exited before readiness');
        return fetch(`${apiUrl}/api/v1/health`)
          .then((response) => response.ok)
          .catch(() => false);
      },
      { timeout: 60_000 },
    )
    .toBe(true);
});

test.afterAll(async (): Promise<void> => {
  await stopApi(api);
  await container?.stop();
  await releaseApiPort?.();
});

async function createAccount(
  request: APIRequestContext,
  name: string,
  initialBalance: string,
  currencyCode: string,
): Promise<string> {
  const response = await request.post(`${apiUrl}/api/v1/accounts`, {
    headers: { Cookie: cookie },
    data: {
      name,
      typeKey: 'savings-account',
      initialBalance,
      currencyCode,
      currencyMinorUnitScale: 2,
      color: null,
      description: null,
      icon: null,
      institution: null,
    },
  });
  expect(response.status()).toBe(201);
  return ((await response.json()) as { id: string }).id;
}

test('a reserve splits available from the book balance without creating net worth (US-051)', async ({
  page,
  context,
  request,
}) => {
  const headers = { Cookie: cookie };
  const accountId = await createAccount(request, 'Poupança', '100.00', 'BRL');
  await context.addCookies([
    {
      name: '__Host-seshat_session',
      value: token,
      domain: 'localhost',
      path: '/',
      secure: true,
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
  const consolidation = async (): Promise<unknown> =>
    (
      await request.get(`${apiUrl}/api/v1/accounts/consolidation`, { headers })
    ).json();
  const netWorthBefore = await consolidation();

  // Cenário: Reserva não cria patrimônio.
  await page.goto(`/contas/${accountId}`);
  const panel = page.getByRole('region', { name: 'Reserva' });
  await expect(panel.getByTestId('reserve-available')).toHaveText('100,00 BRL');
  await panel.getByLabel('Novo valor da reserva (BRL)').fill('30,00');
  await panel.getByRole('button', { name: 'Revisar reserva' }).click();
  await expect(panel.getByRole('group')).toContainText(
    'o disponível passa de 100,00 BRL para 70,00 BRL',
  );
  await panel.getByRole('button', { name: 'Confirmar reserva' }).click();
  await expect(panel.getByRole('status')).toContainText('Reserva salva');
  await expect(panel.getByTestId('reserve-available')).toHaveText('70,00 BRL');
  await expect(panel.getByTestId('reserve-reserved')).toHaveText('30,00 BRL');
  await expect(panel.getByTestId('reserve-book')).toHaveText('100,00 BRL');
  expect(await consolidation()).toEqual(netWorthBefore);

  // Cenário: Valor acima do saldo elegível (recusa no servidor, sem efeito).
  const refused = await request.put(
    `${apiUrl}/api/v1/accounts/${accountId}/reserve`,
    {
      data: { amount: '120.00', expectedVersion: 1 },
      headers: { ...headers, 'Idempotency-Key': randomUUID() },
    },
  );
  expect(refused.status()).toBe(422);
  await panel.getByLabel('Novo valor da reserva (BRL)').fill('120,00');
  await panel.getByRole('button', { name: 'Revisar reserva' }).click();
  await expect(panel.getByRole('alert')).toContainText(
    'não pode ser maior que o saldo contábil',
  );
  await expect(panel.getByTestId('reserve-reserved')).toHaveText('30,00 BRL');

  // Cenário: Remover reserva.
  await panel.getByRole('button', { name: 'Remover reserva' }).click();
  await expect(panel.getByRole('group')).toContainText(
    'o disponível passa de 70,00 BRL para 100,00 BRL',
  );
  await panel.getByRole('button', { name: 'Confirmar reserva' }).click();
  await expect(panel.getByRole('status')).toContainText('Reserva removida');
  await expect(panel.getByTestId('reserve-available')).toHaveText('100,00 BRL');
  await expect(panel.getByTestId('reserve-book')).toHaveText('100,00 BRL');
  expect(await consolidation()).toEqual(netWorthBefore);

  const summary = await request.get(`${apiUrl}/api/v1/accounts/availability`, {
    headers,
  });
  expect(await summary.json()).toMatchObject({
    totalsByCurrency: [
      {
        available: { amount: '100.00' },
        book: { amount: '100.00' },
        reserved: { amount: '0.00' },
      },
    ],
  });
});
