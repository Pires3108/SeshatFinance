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

test('a manual investment is registered, archived, trashed and restored without touching balances (US-054)', async ({
  page,
  context,
  request,
}) => {
  const headers = { Cookie: cookie };
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

  await page.goto('/investimentos');
  await expect(page.getByText('Nenhum investimento registrado.')).toBeVisible();
  await page.getByRole('button', { name: 'Registrar investimento' }).click();
  await page.getByLabel('Tipo').selectOption('treasury-direct');
  await page.getByLabel('Instituição').fill('Tesouro Nacional');
  await page.getByLabel('Ativo').fill('Tesouro IPCA+ 2035');
  await page.getByLabel('Data inicial').fill('2026-02-01');
  await page.getByLabel('Vencimento (opcional)').fill('2035-05-15');
  await page
    .getByLabel('Indexador da taxa contratada (opcional)')
    .selectOption('ipca');
  await page.getByLabel('Taxa contratada (%)').fill('6,5');
  await page.getByLabel('Liquidez').selectOption('d-plus');
  await page.getByLabel('Dias úteis para resgate').fill('1');

  // Cenário: dados inconsistentes são recusados antes do envio.
  await page.getByLabel('Vencimento (opcional)').fill('2025-01-01');
  await page.getByRole('button', { name: 'Salvar investimento' }).click();
  await expect(page.locator('main').getByRole('alert')).toContainText(
    'O vencimento não pode ser anterior à data inicial.',
  );
  await page.getByLabel('Vencimento (opcional)').fill('2035-05-15');

  await page.getByRole('button', { name: 'Salvar investimento' }).click();
  await expect(page.getByRole('status')).toContainText(
    'Investimento registrado: Tesouro IPCA+ 2035',
  );
  const card = page
    .getByRole('listitem')
    .filter({ hasText: 'Tesouro IPCA+ 2035' });
  await expect(card).toContainText('Tesouro Direto · Tesouro Nacional · BRL');
  await expect(card).toContainText('Vence em 15/05/2035');
  await expect(card).toContainText('Liquidez em D+1');
  await expect(card).toContainText('Taxa contratada: IPCA + 6,5%');

  // Cenário: registrar não cria lançamento nem conta.
  const accounts = await request.get(`${apiUrl}/api/v1/accounts`, { headers });
  expect(await accounts.json()).toEqual([]);

  await card.getByRole('button', { name: 'Arquivar' }).click();
  await expect(card).toContainText('Arquivado');
  await card.getByRole('button', { name: 'Mover para a lixeira' }).click();
  await expect(card).toContainText('Na lixeira');
  await card.getByRole('button', { name: 'Restaurar' }).click();
  await expect(card).toContainText('Ativo');

  const list = await request.get(`${apiUrl}/api/v1/investments`, { headers });
  expect(await list.json()).toMatchObject([
    {
      contractedRate: { indexer: 'ipca', percent: '6.5' },
      lifecycle: 'active',
      quantityScale: 2,
      type: 'treasury-direct',
      version: 4,
    },
  ]);
});

test('an aporte with an account lowers the balance once, is undone by the trash and a resgate above custody is refused (US-055)', async ({
  page,
  context,
  request,
}) => {
  const headers = { Cookie: cookie };
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
  const created = await request.post(`${apiUrl}/api/v1/accounts`, {
    headers,
    data: {
      name: 'Conta da corretora',
      typeKey: 'checking-account',
      initialBalance: '5000.00',
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
  const registered = await request.post(`${apiUrl}/api/v1/investments`, {
    headers: { ...headers, 'Idempotency-Key': randomUUID() },
    data: {
      code: 'PETR4',
      currencyCode: 'BRL',
      currencyMinorUnitScale: 2,
      institution: 'Corretora Exemplo',
      liquidity: { days: 2, kind: 'd-plus' },
      name: 'Petrobras PN',
      startDate: '2026-01-02',
      type: 'stock',
    },
  });
  expect(registered.status()).toBe(201);
  const balance = async (): Promise<unknown> =>
    (
      await request.get(`${apiUrl}/api/v1/accounts/${account.id}/balance`, {
        headers,
      })
    ).json();

  await page.goto('/investimentos');
  const card = page
    .getByRole('list', { name: 'Investimentos' })
    .getByRole('listitem')
    .filter({
      has: page.getByRole('heading', { name: 'Petrobras PN (PETR4)' }),
    });
  await card.getByRole('button', { name: 'Movimentações' }).click();
  const panel = page.getByRole('region', {
    name: 'Movimentações de Petrobras PN',
  });
  await expect(panel).toContainText('Nenhuma movimentação registrada.');

  await panel.getByLabel('Tipo de evento').selectOption('contribution');
  await panel.getByLabel('Valor (BRL)').fill('1500,00');
  await panel.getByLabel('Quantidade').fill('100');
  await panel.getByLabel('Preço unitário (opcional)').fill('15');
  await panel.getByLabel('Data').fill('2026-03-10T12:00');
  await panel.getByLabel('Conta (opcional)').selectOption(account.id);
  await panel.getByRole('button', { name: 'Registrar evento' }).click();
  await expect(panel.getByRole('status')).toContainText(
    'Aporte registrado em Petrobras PN',
  );
  const events = panel.getByRole('list', { name: 'Eventos de Petrobras PN' });
  await expect(events).toContainText('Aporte · 10/03/2026 · BRL 1500,00');
  await expect(events).toContainText('100 un. · Saiu da conta');
  expect(await balance()).toMatchObject({ amount: '3500.00' });

  // Cenário: o resgate acima da custódia é recusado sem efeito parcial.
  await panel.getByLabel('Tipo de evento').selectOption('redemption');
  await panel.getByLabel('Valor (BRL)').fill('1700');
  await panel.getByLabel('Quantidade').fill('101');
  await panel.getByLabel('Conta (opcional)').selectOption(account.id);
  await panel.getByRole('button', { name: 'Registrar evento' }).click();
  await expect(panel.getByRole('alert')).toContainText(
    'o resgate não passa da quantidade em custódia',
  );
  expect(await balance()).toMatchObject({ amount: '3500.00' });

  // Cenário: o aporte na lixeira leva junto a saída da conta.
  await events
    .getByRole('button', { name: 'Mover aporte para a lixeira' })
    .click();
  await expect(events).toContainText('Na lixeira');
  expect(await balance()).toMatchObject({ amount: '5000.00' });
  await events.getByRole('button', { name: 'Restaurar aporte' }).click();
  await expect(events).not.toContainText('Na lixeira');
  expect(await balance()).toMatchObject({ amount: '3500.00' });
});
