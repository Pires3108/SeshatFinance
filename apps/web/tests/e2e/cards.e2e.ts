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
const userId = randomUUID();
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
  api?.kill();
  await container?.stop();
});

test('cards register, show the business-day due date and update with version through the real API', async ({
  page,
  context,
  request,
}) => {
  const headers = { Cookie: cookie };
  const created = await request.post(`${apiUrl}/api/v1/accounts`, {
    headers,
    data: {
      name: 'Conta pagadora',
      typeKey: 'checking-account',
      initialBalance: '0.00',
      currencyCode: 'BRL',
      currencyMinorUnitScale: 2,
      color: null,
      description: null,
      icon: null,
      institution: null,
    },
  });
  expect(created.status()).toBe(201);
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

  await page.goto('/preferencias');
  await page.getByLabel('Estado (UF)').selectOption('SP');
  await page.getByLabel('Código do município (IBGE)').fill('3550308');
  await page.getByRole('button', { name: 'Salvar local' }).click();
  await expect(page.getByText('Local dos feriados atualizado.')).toBeVisible();

  await page.goto('/cartoes');
  await expect(
    page.getByText('Você ainda não cadastrou cartões.'),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Cadastrar cartão' }).click();
  await page.getByLabel('Nome').fill('Cartão sintético');
  await page.getByLabel('Bandeira').fill('Visa');
  await page
    .getByLabel('Conta pagadora')
    .selectOption({ label: 'Conta pagadora (BRL)' });
  await page.getByLabel('Limite').fill('3500,00');
  await page.getByLabel('Dia de fechamento').fill('30');
  await page.getByLabel('Dia de vencimento').fill('9');
  await page.getByRole('button', { name: 'Salvar cartão' }).click();
  await expect(page.getByRole('status')).toContainText('Cartão cadastrado.');
  const item = page
    .getByRole('listitem')
    .filter({ hasText: 'Cartão sintético' });
  await expect(item).toContainText('3.500,00 BRL');
  await expect(item).toContainText('Limite organizacional');
  await expect(item).toContainText('Fatura atual');

  const cards = (await (
    await request.get(`${apiUrl}/api/v1/credit-cards`, { headers })
  ).json()) as { id: string; version: number }[];
  expect(cards).toHaveLength(1);
  const cardId = cards[0]?.id ?? '';
  // Cycle closing 30/06/2027 is due Friday 09/07/2027, a São Paulo state holiday.
  const cycle = await request.get(
    `${apiUrl}/api/v1/credit-cards/${cardId}/cycle?at=2027-06-15T12:00:00Z`,
    { headers },
  );
  expect(await cycle.json()).toMatchObject({
    closesOn: '2027-06-30',
    dueOn: '2027-07-12',
    scheduledDueOn: '2027-07-09',
    timeZone: 'America/Sao_Paulo',
  });

  await item.getByRole('button', { name: 'Editar' }).click();
  await page.getByLabel('Nome').fill('Cartão viagem');
  await page
    .getByLabel('Compras no dia do fechamento entram na fatura que fecha')
    .check();
  await page.getByRole('button', { name: 'Salvar cartão' }).click();
  await expect(page.getByRole('status')).toContainText('Cartão atualizado.');
  await expect(
    page.getByRole('listitem').filter({ hasText: 'Cartão viagem' }),
  ).toContainText('entram na fatura que fecha');

  const stale = await request.patch(`${apiUrl}/api/v1/credit-cards/${cardId}`, {
    headers,
    data: {
      brand: 'Visa',
      closingBoundary: 'next-cycle',
      closingDay: 30,
      dueDay: 9,
      expectedVersion: 1,
      limit: '3500.00',
      name: 'Concorrente',
    },
  });
  expect(stale.status()).toBe(409);
});

test('a card purchase joins the current invoice without changing the paying account', async ({
  page,
  context,
  request,
}) => {
  const headers = { Cookie: cookie };
  const account = (await (
    await request.post(`${apiUrl}/api/v1/accounts`, {
      headers,
      data: {
        name: 'Conta da compra',
        typeKey: 'checking-account',
        initialBalance: '500.00',
        currencyCode: 'BRL',
        currencyMinorUnitScale: 2,
        color: null,
        description: null,
        icon: null,
        institution: null,
      },
    })
  ).json()) as { id: string };
  const card = await request.post(`${apiUrl}/api/v1/credit-cards`, {
    headers,
    data: {
      brand: 'Elo',
      closingDay: 31,
      currencyCode: 'BRL',
      currencyMinorUnitScale: 2,
      dueDay: 10,
      limit: '2000.00',
      name: 'Cartão das compras',
      paymentAccountId: account.id,
    },
  });
  expect(card.status()).toBe(201);
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

  await page.goto('/cartoes');
  const item = page
    .getByRole('listitem')
    .filter({ hasText: 'Cartão das compras' });
  await item
    .getByRole('button', { name: 'Registrar compra realizada' })
    .click();
  await item.getByLabel('Descrição').fill('Livraria');
  await item.getByLabel('Valor (BRL)').fill('89,90');
  await item.getByRole('button', { name: 'Registrar compra' }).click();
  await expect(item.getByRole('status')).toContainText('Compra registrada');
  await expect(item).toContainText('Livraria: 89,90 BRL');

  const balance = await request.get(
    `${apiUrl}/api/v1/accounts/${account.id}/balance`,
    { headers },
  );
  expect(await balance.json()).toMatchObject({ amount: '500.00' });
});

test('an invoice closes once and later purchases join the next invoice', async ({
  page,
  context,
  request,
}) => {
  const headers = { Cookie: cookie };
  const account = (await (
    await request.post(`${apiUrl}/api/v1/accounts`, {
      headers,
      data: {
        name: 'Conta da fatura',
        typeKey: 'checking-account',
        initialBalance: '0.00',
        currencyCode: 'BRL',
        currencyMinorUnitScale: 2,
        color: null,
        description: null,
        icon: null,
        institution: null,
      },
    })
  ).json()) as { id: string };
  const card = (await (
    await request.post(`${apiUrl}/api/v1/credit-cards`, {
      headers,
      data: {
        brand: 'Visa',
        closingDay: 28,
        currencyCode: 'BRL',
        currencyMinorUnitScale: 2,
        dueDay: 7,
        limit: '1000.00',
        name: 'Cartão da fatura',
        paymentAccountId: account.id,
      },
    })
  ).json()) as { id: string };
  const purchase = (
    amount: string,
    description: string,
  ): ReturnType<typeof request.post> =>
    request.post(`${apiUrl}/api/v1/credit-cards/${card.id}/purchases`, {
      headers: { ...headers, 'Idempotency-Key': randomUUID() },
      data: {
        amount,
        currencyCode: 'BRL',
        currencyMinorUnitScale: 2,
        description,
        occurredAt: '2026-10-20T15:00:00Z',
      },
    });
  expect((await purchase('100.00', 'Antes do fechamento')).status()).toBe(201);
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

  await page.goto('/cartoes');
  const invoices = page.getByRole('region', {
    name: 'Faturas do Cartão da fatura',
  });
  await expect(invoices).toContainText('Fatura de 28/10/2026 — Aberta');
  await invoices.getByRole('button', { name: 'Fechar fatura' }).click();
  await invoices.getByRole('button', { name: 'Confirmar fechamento' }).click();
  await expect(invoices.getByRole('status')).toContainText(
    'Fatura de 28/10/2026 fechada.',
  );
  await expect(invoices).toContainText('Fatura de 28/10/2026 — Fechada');

  const late = await purchase('25.00', 'Depois do fechamento');
  expect(await late.json()).toMatchObject({
    cycleClosesOn: '2026-11-28',
    postedAfterClose: true,
  });
  await page.reload();
  await expect(invoices).toContainText('Fatura de 28/11/2026 — Aberta');
  const closed = await request.get(
    `${apiUrl}/api/v1/credit-cards/${card.id}/invoices/2026-10-28`,
    { headers },
  );
  expect(await closed.json()).toMatchObject({
    closedTotal: '100.00',
    purchasesTotal: '100.00',
    status: 'closed',
  });
});
