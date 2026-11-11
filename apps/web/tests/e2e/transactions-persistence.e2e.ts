import { spawn, type ChildProcess } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { access, cp, readFile, readdir } from 'node:fs/promises';
import { createServer } from 'node:net';
import { dirname, resolve } from 'node:path';

import { expect, test } from '@playwright/test';
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { Client } from 'pg';

let apiUrl = '';
let webUrl = '';
const token = randomBytes(32).toString('base64url');
const cookie = `__Host-seshat_session=${token}`;
const ownerId = randomUUID();
const selectedDate = '2026-11-03';
let container: StartedPostgreSqlContainer | undefined;
let api: ChildProcess | undefined;
let web: ChildProcess | undefined;

test.use({ timezoneId: 'America/Sao_Paulo' });

async function availablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('Could not reserve an API port');
  }
  await new Promise<void>((resolveClose, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolveClose();
    });
  });
  return address.port;
}

async function standaloneServer(): Promise<string> {
  const candidates = [
    resolve(process.cwd(), '.next/standalone/apps/web/server.js'),
    resolve(process.cwd(), '.next/standalone/server.js'),
  ];
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Try the other standalone layout.
    }
  }
  throw new Error(
    'Build the web standalone output before this Playwright test',
  );
}

test.beforeAll(async (): Promise<void> => {
  test.setTimeout(120_000);
  const apiPort = await availablePort();
  apiUrl = `http://127.0.0.1:${String(apiPort)}`;
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
      'INSERT INTO user_profiles (id, created_at, updated_at) VALUES ($1, now(), now())',
      [ownerId],
    );
    await client.query(
      'INSERT INTO user_sessions (id, user_id, token_hash, created_at, last_seen_at) VALUES ($1, $2, $3, now(), now())',
      [randomUUID(), ownerId, createHash('sha256').update(token).digest('hex')],
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
        API_PORT: String(apiPort),
        DATABASE_URL: container.getConnectionUri(),
      },
      stdio: 'ignore',
      windowsHide: true,
    },
  );
  await expect
    .poll(
      async () => {
        if (api?.exitCode !== null || api.signalCode !== null)
          throw new Error('API exited before readiness');
        return fetch(`${apiUrl}/api/v1/health/ready`)
          .then((response) => response.ok)
          .catch(() => false);
      },
      { timeout: 60_000 },
    )
    .toBe(true);

  const serverPath = await standaloneServer();
  const serverDirectory = dirname(serverPath);
  await cp(
    resolve(process.cwd(), '.next/static'),
    resolve(serverDirectory, '.next/static'),
    { recursive: true },
  );
  try {
    await cp(
      resolve(process.cwd(), 'public'),
      resolve(serverDirectory, 'public'),
      {
        recursive: true,
      },
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const webPort = await availablePort();
  webUrl = `http://localhost:${String(webPort)}`;
  web = spawn(process.execPath, [serverPath], {
    cwd: serverDirectory,
    env: {
      ...process.env,
      HOSTNAME: 'localhost',
      PORT: String(webPort),
      SESHAT_API_URL: apiUrl,
    },
    stdio: 'ignore',
    windowsHide: true,
  });
  await expect
    .poll(
      async () => {
        if (web?.exitCode !== null || web.signalCode !== null)
          throw new Error('Web server exited before readiness');
        return fetch(`${webUrl}/entrar`)
          .then((response) => response.ok)
          .catch(() => false);
      },
      { timeout: 60_000 },
    )
    .toBe(true);
});

test.afterAll(async (): Promise<void> => {
  web?.kill();
  api?.kill();
  await container?.stop();
});

test('income and expense persist with exact balance and temporal totals', async ({
  page,
  context,
  request,
}) => {
  const headers = { Cookie: cookie };
  const created = await request.post(`${apiUrl}/api/v1/accounts`, {
    headers,
    data: {
      name: 'Conta de teste',
      typeKey: 'checking-account',
      initialBalance: '1000.00',
      currencyCode: 'BRL',
      currencyMinorUnitScale: 2,
      color: null,
      description: null,
      icon: null,
      institution: null,
    },
  });
  expect(created.status()).toBe(201);
  const account = (await created.json()) as { id: string };
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

  await page.goto(`${webUrl}/contas/${account.id}/movimentacoes`);
  await expect(page.getByRole('status')).toContainText(
    'Nenhuma movimentação nesta conta.',
  );
  for (const entry of [
    { kind: 'Receita', amount: '300,10', description: 'Receita de teste' },
    { kind: 'Despesa', amount: '65,60', description: 'Despesa de teste' },
  ]) {
    await page.getByLabel('Tipo').selectOption({ label: entry.kind });
    await page.getByLabel('Valor em BRL').fill(entry.amount);
    await page.getByLabel('Data e hora').fill('2026-11-03T12:30');
    await page.getByLabel('Descrição').fill(entry.description);
    const saved = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/api/accounts/${account.id}/transactions`) &&
        response.request().method() === 'POST',
    );
    await page.getByRole('button', { name: 'Salvar movimentação' }).click();
    expect((await saved).status()).toBe(201);
    await expect(page.getByText(entry.description)).toBeVisible();
  }

  const balance = await request.get(
    `${apiUrl}/api/v1/accounts/${account.id}/balance`,
    { headers },
  );
  expect(balance.status()).toBe(200);
  expect(await balance.json()).toMatchObject({
    amount: '1234.50',
    currencyCode: 'BRL',
  });
  const otherToken = randomBytes(32).toString('base64url');
  const client = new Client({
    connectionString: container?.getConnectionUri(),
  });
  await client.connect();
  try {
    await client.query(
      'INSERT INTO user_sessions (id, user_id, token_hash, created_at, last_seen_at) VALUES ($1, $2, $3, now(), now())',
      [
        randomUUID(),
        randomUUID(),
        createHash('sha256').update(otherToken).digest('hex'),
      ],
    );
  } finally {
    await client.end();
  }
  const otherHeaders = { Cookie: `__Host-seshat_session=${otherToken}` };
  const otherBalance = await request.get(
    `${apiUrl}/api/v1/accounts/${account.id}/balance`,
    { headers: otherHeaders },
  );
  expect(otherBalance.status()).toBe(404);
  const otherEntries = await request.get(
    `${apiUrl}/api/v1/accounts/${account.id}/transactions`,
    { headers: otherHeaders },
  );
  expect(otherEntries.status()).toBe(404);
  await page.reload();
  await expect(page.getByText('Receita de teste')).toBeVisible();
  await expect(page.getByText('Despesa de teste')).toBeVisible();
  await page.goto(`${webUrl}/contas/${account.id}`);
  await expect(page.getByText('1.234,50 BRL')).toBeVisible();

  // Wait for the profile-driven initial load so the picked date is kept.
  const zoneNote = page.getByText(
    'Datas e horários no fuso America/Sao_Paulo.',
  );
  await page.goto(`${webUrl}/movimentacoes`);
  await expect(zoneNote).toBeVisible();
  await page.getByLabel('Selecionar dia').fill(selectedDate);
  for (const period of ['Dia', 'Semana', 'Mês']) {
    await page.getByRole('button', { name: period, exact: true }).click();
    await expect(page.getByText('Receita de teste')).toBeVisible();
    await expect(page.getByText('Despesa de teste')).toBeVisible();
    const totals = page.getByRole('region', { name: 'Totais do período' });
    await expect(totals).toContainText('300,10 BRL');
    await expect(totals).toContainText('65,60 BRL');
  }
  await page.reload();
  await expect(zoneNote).toBeVisible();
  await page.getByLabel('Selecionar dia').fill(selectedDate);
  await expect(page.getByText('Receita de teste')).toBeVisible();
  await expect(page.getByText('Despesa de teste')).toBeVisible();
});
