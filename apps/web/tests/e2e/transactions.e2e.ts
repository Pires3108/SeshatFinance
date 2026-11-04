import { expect, test } from '@playwright/test';

const accountId = 'c15a5404-7f4e-4f4b-a2d8-cb00f406d63a';
const transactionId = 'd15a5404-7f4e-4f4b-a2d8-cb00f406d63a';
const account = {
  id: accountId,
  name: 'Conta principal',
  typeKey: 'checking-account',
  lifecycle: 'active',
  currencyCode: 'BRL',
  currencyMinorUnitScale: 2,
};
const balance = {
  amount: '100.00',
  currencyCode: 'BRL',
  currencyMinorUnitScale: 2,
};

test.use({ timezoneId: 'America/Sao_Paulo' });

test('records and edits an expense through API routes', async ({ page }) => {
  let transaction: Record<string, unknown> | null = null;
  let createdOccurredAt: string | null = null;
  await page.route(`**/api/accounts/${accountId}`, async (route) =>
    route.fulfill({ json: { account, balance } }),
  );
  await page.route(
    `**/api/accounts/${accountId}/transactions`,
    async (route) => {
      if (route.request().method() === 'GET')
        return route.fulfill({ json: transaction ? [transaction] : [] });
      expect(route.request().headers()['idempotency-key']).toBeTruthy();
      const body: unknown = route.request().postDataJSON();
      expect(body).toBeTruthy();
      createdOccurredAt = (body as Record<string, unknown>)
        .occurredAt as string;
      expect(createdOccurredAt).toBe('2026-11-03T15:30:00.000Z');
      transaction = {
        ...(body as Record<string, unknown>),
        id: transactionId,
        accountId,
        lifecycle: 'active',
        version: 1,
      };
      return route.fulfill({ status: 201, json: transaction });
    },
  );
  await page.route(`**/api/transactions/${transactionId}`, async (route) => {
    const body: unknown = route.request().postDataJSON();
    expect(body).toBeTruthy();
    expect((body as Record<string, unknown>).occurredAt).toBe(
      createdOccurredAt,
    );
    transaction = {
      ...transaction,
      ...(body as Record<string, unknown>),
      version: 2,
    };
    await route.fulfill({ json: transaction });
  });
  await page.goto(`/contas/${accountId}/movimentacoes`);
  await page.getByLabel('Valor em BRL').fill('12,34');
  await page.getByLabel('Data e hora').fill('2026-11-03T12:30');
  await page.getByLabel('Descrição').fill('Almoço');
  await page.getByRole('button', { name: 'Salvar movimentação' }).click();
  await expect(
    page.getByRole('heading', { name: 'Despesa · 12,34 BRL' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Editar' }).click();
  await expect(page.getByLabel('Data e hora')).toHaveValue('2026-11-03T12:30');
  await page.getByLabel('Descrição').fill('Almoço de equipe');
  await page.getByRole('button', { name: 'Salvar movimentação' }).click();
  await expect(page.getByText('Almoço de equipe')).toBeVisible();
});
