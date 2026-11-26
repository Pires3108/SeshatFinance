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

async function createGoal(
  request: APIRequestContext,
  name: string,
): Promise<string> {
  const response = await request.post(`${apiUrl}/api/v1/goals`, {
    data: {
      currencyCode: 'BRL',
      currencyMinorUnitScale: 2,
      links: [],
      mode: 'free',
      name,
      target: '500.00',
    },
    headers: { Cookie: cookie, 'Idempotency-Key': randomUUID() },
  });
  expect(response.status()).toBe(201);
  return ((await response.json()) as { id: string }).id;
}

test('an income is split between goals within its value and the trash recalculates progress (US-050)', async ({
  page,
  context,
  request,
}) => {
  const headers = { Cookie: cookie };
  const accountId = await createAccount(request, 'Corrente', '0.00', 'BRL');
  const income = await request.post(
    `${apiUrl}/api/v1/accounts/${accountId}/transactions`,
    {
      data: {
        amount: '100.00',
        currencyCode: 'BRL',
        currencyMinorUnitScale: 2,
        description: 'Salário',
        kind: 'income',
        observations: null,
        occurredAt: '2026-11-20T12:00:00Z',
      },
      headers,
    },
  );
  expect(income.status()).toBe(201);
  const incomeId = ((await income.json()) as { id: string }).id;
  await createGoal(request, 'Viagem');
  await createGoal(request, 'Reserva técnica');
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
  const balance = async (): Promise<unknown> =>
    (
      await request.get(`${apiUrl}/api/v1/accounts/${accountId}/balance`, {
        headers,
      })
    ).json();

  await page.goto('/metas');
  const section = page.getByRole('region', {
    name: 'Distribuir entrada entre metas',
  });
  await section.getByLabel('Entrada').selectOption(incomeId);

  // Cenário: Soma excede a origem.
  await section.getByLabel('Para Viagem (BRL)').fill('70,00');
  await section.getByLabel('Para Reserva técnica (BRL)').fill('40,00');
  await section.getByRole('button', { name: 'Revisar distribuição' }).click();
  await expect(section.getByRole('alert')).toContainText(
    'passa do valor da entrada',
  );
  const refused = await request.put(
    `${apiUrl}/api/v1/goal-contributions/${incomeId}`,
    {
      data: {
        expectedVersion: 0,
        lines: [
          { amount: '70.00', goalId: (await goalIds(request))[0] },
          { amount: '40.00', goalId: (await goalIds(request))[1] },
        ],
      },
      headers: { ...headers, 'Idempotency-Key': randomUUID() },
    },
  );
  expect(refused.status()).toBe(422);

  // Cenário: Divisão dentro do valor de origem.
  await section.getByLabel('Para Viagem (BRL)').fill('60,00');
  await section.getByRole('button', { name: 'Revisar distribuição' }).click();
  await expect(section.getByRole('group')).toContainText(
    'Restante da entrada: 0,00 BRL',
  );
  await section.getByRole('button', { name: 'Confirmar distribuição' }).click();
  await expect(section.getByRole('status')).toContainText('Distribuição salva');
  const trip = page.getByRole('listitem').filter({ hasText: 'Viagem' }).first();
  const spare = page
    .getByRole('listitem')
    .filter({ hasText: 'Reserva técnica' })
    .first();
  await expect(trip).toContainText('Acumulado 60,00 BRL');
  await expect(spare).toContainText('Acumulado 40,00 BRL');
  expect(await balance()).toMatchObject({ amount: '100.00' });

  // Cenário: Origem enviada à lixeira.
  const trashed = await request.patch(
    `${apiUrl}/api/v1/transactions/${incomeId}/lifecycle`,
    { data: { action: 'move-to-trash' }, headers },
  );
  expect(trashed.ok()).toBe(true);
  await page.reload();
  await expect(trip).toContainText('Acumulado 0,00 BRL');
  await expect(trip).toContainText('Entrada na lixeira');
});

async function goalIds(request: APIRequestContext): Promise<string[]> {
  const response = await request.get(`${apiUrl}/api/v1/goals`, {
    headers: { Cookie: cookie },
  });
  const goals = (await response.json()) as { id: string; name: string }[];
  return ['Viagem', 'Reserva técnica'].map(
    (name) => goals.find((goal) => goal.name === name)?.id ?? '',
  );
}

test('completed and overdue goals are named in text, not only by color (US-053)', async ({
  page,
  context,
  request,
}) => {
  const create = async (data: Record<string, unknown>): Promise<void> => {
    const response = await request.post(`${apiUrl}/api/v1/goals`, {
      data: {
        currencyCode: 'BRL',
        currencyMinorUnitScale: 2,
        links: [],
        mode: 'free',
        target: '500.00',
        ...data,
      },
      headers: { Cookie: cookie, 'Idempotency-Key': randomUUID() },
    });
    expect(response.status()).toBe(201);
  };
  await create({ initialAmount: '500.00', name: 'Meta cumprida' });
  await create({ deadline: '2026-01-01', name: 'Meta vencida' });
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

  await page.goto('/metas');
  await expect(
    page.getByRole('listitem').filter({ hasText: 'Meta cumprida' }).first(),
  ).toContainText('Concluída');
  await expect(
    page.getByRole('listitem').filter({ hasText: 'Meta vencida' }).first(),
  ).toContainText('Atrasada');
});
