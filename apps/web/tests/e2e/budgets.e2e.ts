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

/** Current civil month in the profile zone (America/Sao_Paulo). */
function months(): Readonly<{ current: string; next: string }> {
  const parts = new Intl.DateTimeFormat('en-CA', {
    month: '2-digit',
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
  })
    .format(new Date())
    .split('-');
  const year = Number(parts[0]);
  const month = Number(parts[1]);
  const next = month === 12 ? [year + 1, 1] : [year, month + 1];
  const format = (y: number, m: number): string =>
    `${String(y)}-${String(m).padStart(2, '0')}`;
  return {
    current: format(year, month),
    next: format(next[0] ?? year, next[1] ?? 1),
  };
}

test('a monthly budget compares realized expenses and warns on excess without blocking (US-052)', async ({
  page,
  context,
  request,
}) => {
  const headers = { Cookie: cookie };
  const { current, next } = months();
  const accountId = await createAccount(request, 'Corrente', '0.00', 'BRL');
  const category = await request.post(`${apiUrl}/api/v1/categories`, {
    data: { name: 'Mercado do bairro', parentCategoryId: null },
    headers,
  });
  expect(category.status()).toBe(201);
  const categoryId = ((await category.json()) as { id: string }).id;
  const expense = async (amount: string, occurredAt: string): Promise<void> => {
    const response = await request.post(
      `${apiUrl}/api/v1/accounts/${accountId}/transactions`,
      {
        data: {
          amount,
          categoryId,
          currencyCode: 'BRL',
          currencyMinorUnitScale: 2,
          description: null,
          kind: 'expense',
          observations: null,
          occurredAt,
        },
        headers,
      },
    );
    expect(response.status()).toBe(201);
  };
  // Cenário: Consumo usa despesas válidas do período.
  await expense('120.00', `${current}-01T15:00:00Z`);
  // Cenário: Lançamento de outro período (início do mês seguinte).
  await expense('80.00', `${next}-01T15:00:00Z`);
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

  await page.goto('/orcamentos');
  await page.getByLabel('Mês').fill(current);
  await expect(page.getByText('Nenhum orçamento criado.')).toBeVisible();
  await page.getByRole('button', { name: 'Criar orçamento' }).click();
  await page.getByLabel('Nome').fill('Mercado');
  await page.getByLabel('Categoria', { exact: true }).selectOption(categoryId);
  await page.getByLabel('Limite mensal (BRL)').fill('500,00');
  await page.getByRole('button', { name: 'Salvar orçamento' }).click();
  await expect(page.getByRole('status')).toContainText(
    'Orçamento salvo: Mercado',
  );
  const card = page.getByRole('listitem').filter({ hasText: 'Mercado' });
  await expect(card.getByText('Realizado')).toBeVisible();
  await expect(card).toContainText('120,00 BRL');
  await expect(card).toContainText('380,00 BRL');
  await expect(card).not.toContainText('Aviso: orçamento excedido');

  // Cenário: Orçamento excedido.
  await expense('450.00', `${current}-02T15:00:00Z`);
  await page.reload();
  await page.getByLabel('Mês').fill(current);
  await expect(card).toContainText('570,00 BRL');
  await expect(card).toContainText(
    'Aviso: orçamento excedido em 70,00 BRL. É só um aviso organizacional',
  );
  const list = await request.get(`${apiUrl}/api/v1/budgets?month=${next}`, {
    headers,
  });
  expect(await list.json()).toMatchObject([
    { consumption: { realized: { amount: '80.00' } } },
  ]);
});
