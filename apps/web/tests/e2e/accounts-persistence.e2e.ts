import { spawn, type ChildProcess } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';

import { expect, test } from '@playwright/test';
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { Client } from 'pg';

const apiUrl = 'http://localhost:3101';
const token = randomBytes(32).toString('base64url');
const cookie = `__Host-seshat_session=${token}`;
let container: StartedPostgreSqlContainer | undefined;
let api: ChildProcess | undefined;

test.beforeAll(async (): Promise<void> => {
  test.setTimeout(120_000);
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
      [
        randomUUID(),
        randomUUID(),
        createHash('sha256').update(token).digest('hex'),
      ],
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
  api?.kill();
  await container?.stop();
});

test('account list and detail reconcile persisted ledger and lifecycle through the real API', async ({
  page,
  context,
  request,
}) => {
  const headers = { Cookie: cookie };
  const created = await request.post(`${apiUrl}/api/v1/accounts`, {
    headers,
    data: {
      name: 'Conta sintética',
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
  for (const entry of [
    { kind: 'income', amount: '300.10' },
    { kind: 'expense', amount: '65.60' },
  ]) {
    const response = await request.post(
      `${apiUrl}/api/v1/accounts/${account.id}/transactions`,
      {
        headers,
        data: {
          ...entry,
          currencyCode: 'BRL',
          currencyMinorUnitScale: 2,
          description: null,
          observations: null,
          occurredAt: '2026-10-01T12:00:00Z',
        },
      },
    );
    expect(response.status()).toBe(201);
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
  await page.goto('/contas');
  await expect(page.getByRole('listitem')).toHaveCount(1);
  await expect(page.getByRole('listitem')).toContainText('1.234,50 BRL');
  await page.getByRole('link', { name: 'Conta sintética' }).click();
  await expect(
    page.getByRole('heading', { name: 'Conta sintética' }),
  ).toBeVisible();
  await expect(page.getByText('1.234,50 BRL')).toBeVisible();
  await page.reload();
  await expect(page.getByText('1.234,50 BRL')).toBeVisible();
  const archived = await request.patch(
    `${apiUrl}/api/v1/accounts/${account.id}/lifecycle`,
    { headers, data: { action: 'archive' } },
  );
  expect(archived.status()).toBe(200);
  await page.goto('/contas');
  await expect(page.getByRole('status')).toContainText(
    'Nenhuma conta nesta seção.',
  );
  await page.getByRole('button', { name: 'Arquivadas' }).click();
  await expect(page.getByRole('listitem')).toContainText('1.234,50 BRL');
  page.on('dialog', (dialog) => {
    void dialog.accept();
  });
  const trashResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/accounts/${account.id}/lifecycle`) &&
      response.request().method() === 'PATCH',
  );
  await page.getByRole('button', { name: 'Mover para a lixeira' }).click();
  expect((await trashResponse).status()).toBe(200);
  await expect(page.getByRole('status')).toContainText(
    'Nenhuma conta nesta seção.',
  );
  await page.getByRole('button', { name: 'Lixeira' }).click();
  await page.getByRole('button', { name: 'Restaurar da lixeira' }).click();
  await page.getByRole('button', { name: 'Arquivadas' }).click();
  await expect(page.getByRole('listitem')).toContainText('1.234,50 BRL');
  const restored = await request.get(
    `${apiUrl}/api/v1/accounts/${account.id}`,
    { headers },
  );
  expect(await restored.json()).toMatchObject({ lifecycle: 'archived' });
});
