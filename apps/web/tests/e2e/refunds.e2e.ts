import { expect, test } from '@playwright/test';

const accountId = 'c15a5404-7f4e-4f4b-a2d8-cb00f406d63a';
const expenseId = 'e25a5404-7f4e-4f4b-a2d8-cb00f406d63a';
const refundId = 'f35a5404-7f4e-4f4b-a2d8-cb00f406d63a';
const entryId = 'a45a5404-7f4e-4f4b-a2d8-cb00f406d63a';
const account = {
  id: accountId,
  name: 'Conta principal',
  typeKey: 'checking-account',
  lifecycle: 'active',
  currencyCode: 'BRL',
  currencyMinorUnitScale: 2,
};
const expense = {
  id: expenseId,
  accountId,
  amount: '100.00',
  currencyCode: 'BRL',
  currencyMinorUnitScale: 2,
  kind: 'expense',
  occurredAt: '2026-11-03T15:30:00.000Z',
  description: 'Compra devolvida',
  observations: null,
  counterpartyId: null,
  counterpartyName: null,
  categoryId: null,
  subcategoryId: null,
  costCenterId: null,
  tagIds: [],
  version: 1,
  lifecycle: 'active',
};

function details(refunded: '0.00' | '40.00'): Record<string, unknown> {
  const net = refunded === '0.00' ? '100.00' : '60.00';
  return {
    expenseTransactionId: expenseId,
    gross: '100.00',
    refunded,
    net,
    currencyCode: 'BRL',
    currencyMinorUnitScale: 2,
    presentation: 'separate-income',
    displayedExpense: '100.00',
    displayedRefundIncome: refunded,
    entries:
      refunded === '0.00'
        ? []
        : [
            {
              id: refundId,
              kind: 'refund',
              expenseTransactionId: expenseId,
              entryTransactionId: entryId,
              accountId,
              amount: '40.00',
              currencyCode: 'BRL',
              currencyMinorUnitScale: 2,
              description: 'Estorno parcial',
              occurredAt: '2026-11-05T13:00:00.000Z',
              lifecycle: 'active',
              compensatesRefundId: null,
              reason: null,
              createdAt: '2026-11-05T13:00:01.000Z',
            },
          ],
  };
}

test.use({ timezoneId: 'America/Sao_Paulo' });

test('records a partial linked refund, retries safely and shows the net value', async ({
  page,
}) => {
  let refunded: '0.00' | '40.00' = '0.00';
  const keys: string[] = [];
  let attempts = 0;
  await page.route(`**/api/accounts/${accountId}`, async (route) =>
    route.fulfill({
      json: {
        account,
        balance: {
          amount: '100.00',
          currencyCode: 'BRL',
          currencyMinorUnitScale: 2,
        },
      },
    }),
  );
  await page.route(`**/api/accounts/${accountId}/transactions`, async (route) =>
    route.fulfill({ json: [expense] }),
  );
  await page.route(
    `**/api/transactions/${expenseId}/refunds`,
    async (route) => {
      if (route.request().method() === 'GET')
        return route.fulfill({ json: details(refunded) });
      const key = route.request().headers()['idempotency-key'];
      expect(key).toBeTruthy();
      keys.push(key ?? '');
      const body = route.request().postDataJSON() as Record<string, unknown>;
      if (body.amount === '70.00')
        return route.fulfill({ status: 409, json: { error: 'conflict' } });
      expect(body).toMatchObject({
        accountId,
        amount: '40.00',
        currencyCode: 'BRL',
        currencyMinorUnitScale: 2,
        description: 'Estorno parcial',
        occurredAt: '2026-11-05T13:00:00.000Z',
      });
      attempts += 1;
      if (attempts === 1) return route.abort('connectionreset');
      refunded = '40.00';
      const entry = (details('40.00').entries as unknown[])[0];
      return route.fulfill({ status: 201, json: entry });
    },
  );

  await page.goto(`/contas/${accountId}/movimentacoes`);
  await page.getByText('Detalhes').click();
  await expect(page.getByText('Nenhum reembolso vinculado.')).toBeVisible();

  await page.getByLabel('Valor do reembolso em BRL').fill('40,00');
  await page.getByLabel('Data e hora do reembolso').fill('2026-11-05T10:00');
  await page.getByLabel('Descrição do reembolso').fill('Estorno parcial');
  await page.getByRole('button', { name: 'Registrar reembolso' }).click();
  await expect(
    page.getByText('a repetição não duplica o registro', { exact: false }),
  ).toBeVisible();

  await page.getByRole('button', { name: 'Registrar reembolso' }).click();
  await expect(page.getByText('Reembolso registrado.')).toBeVisible();
  expect(keys).toHaveLength(2);
  expect(keys[1]).toBe(keys[0]);

  const summary = page.getByRole('region', { name: 'Reembolsos' });
  await expect(summary.getByText('100,00 BRL')).toBeVisible();
  await expect(summary.getByText('60,00 BRL')).toBeVisible();
  await expect(summary.getByText(/Reembolso · 40,00 BRL/u)).toBeVisible();

  await page.getByLabel('Valor do reembolso em BRL').fill('70,00');
  await page.getByLabel('Data e hora do reembolso').fill('2026-11-06T10:00');
  await page.getByRole('button', { name: 'Registrar reembolso' }).click();
  await expect(
    page.getByText('excede o valor ainda não reembolsado', { exact: false }),
  ).toBeVisible();
  expect(keys[2]).not.toBe(keys[0]);
});
