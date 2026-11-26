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

test('goals are declared without moving money, show USD as unconverted and ask before archiving a linked account (US-049)', async ({
  page,
  context,
  request,
}) => {
  const headers = { Cookie: cookie };
  const usdAccount = await createAccount(
    request,
    'Conta em dólar',
    '80.00',
    'USD',
  );
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

  // Cenário: Meta livre não exige conta.
  await page.goto('/metas');
  await expect(page.getByText('Nenhuma meta criada.')).toBeVisible();
  await page.getByRole('button', { name: 'Criar meta' }).click();
  await page.getByLabel('Nome').fill('Viagem');
  await page.getByLabel('Alvo').fill('500,00');
  await page.getByLabel('Prazo (opcional)').fill('2027-12-31');
  await page.getByRole('button', { name: 'Salvar meta' }).click();
  await expect(page.getByRole('status')).toContainText('Meta salva: Viagem');
  const free = page.getByRole('listitem').filter({ hasText: 'Viagem' });
  await expect(free).toContainText('Alvo 500,00 BRL até 31/12/2027');
  await expect(free).toContainText('Em andamento');

  // Cenário: Conta em outra moeda, sem cotação válida.
  await page.getByRole('button', { name: 'Criar meta' }).click();
  await page.getByLabel('Nome').fill('Intercâmbio');
  await page.getByLabel('Alvo').fill('1000,00');
  await page.getByLabel('Vinculada a contas').check();
  await page.getByLabel('Conta em dólar (USD)').check();
  await page.getByRole('button', { name: 'Salvar meta' }).click();
  await expect(page.getByRole('status')).toContainText(
    'Meta salva: Intercâmbio',
  );
  const linked = page
    .getByRole('listitem')
    .filter({ hasText: 'Intercâmbio' })
    .first();
  await expect(linked).toContainText('Conta em dólar: 80,00 USD');
  await expect(linked).toContainText('Conversão indisponível');
  await expect(linked).toContainText('Progresso convertido indisponível');
  await expect(linked).toContainText('Progresso indisponível (sem cotação)');

  // Saldos permanecem iguais (INV-026).
  const balance = await request.get(
    `${apiUrl}/api/v1/accounts/${usdAccount}/balance`,
    { headers },
  );
  expect(await balance.json()).toMatchObject({ amount: '80.00' });

  // Cenário: Mudança de conta vinculada mostra o impacto antes de confirmar.
  await page.goto(`/contas/${usdAccount}`);
  await page.getByRole('button', { name: 'Arquivar' }).click();
  const panel = page.getByRole('form', {
    name: 'Impacto nas metas de Conta em dólar',
  });
  await expect(panel).toContainText('Intercâmbio');
  await panel.getByRole('button', { name: 'Confirmar e arquivar' }).click();
  await expect(panel.getByRole('alert')).toContainText(
    'Escolha o que fazer com cada meta',
  );
  await panel.getByLabel('Tirar a conta da meta').check();
  await panel.getByRole('button', { name: 'Confirmar e arquivar' }).click();
  await expect(page.getByText('Arquivada', { exact: true })).toBeVisible();

  const goals = (await (
    await request.get(`${apiUrl}/api/v1/goals`, { headers })
  ).json()) as { name: string; mode: string; links: unknown[] }[];
  expect(goals.find((goal) => goal.name === 'Intercâmbio')).toMatchObject({
    links: [],
    mode: 'free',
  });
});
