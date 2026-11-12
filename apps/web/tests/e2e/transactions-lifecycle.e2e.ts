import { expect, test } from '@playwright/test';

const accountId = 'c15a5404-7f4e-4f4b-a2d8-cb00f406d63a';
const transactionId = 'b65a5404-7f4e-4f4b-a2d8-cb00f406d63a';
const account = {
  id: accountId,
  name: 'Conta principal',
  typeKey: 'checking-account',
  lifecycle: 'active',
  currencyCode: 'BRL',
  currencyMinorUnitScale: 2,
};

type Lifecycle = 'active' | 'archived' | 'trashed';

test.use({ timezoneId: 'America/Sao_Paulo' });

test('archives, trashes and restores a transaction to its prior state', async ({
  page,
}) => {
  let lifecycle: Lifecycle = 'active';
  let archived = false;
  let version = 1;
  const actions: string[] = [];
  const transaction = (): Record<string, unknown> => ({
    id: transactionId,
    accountId,
    amount: '25.00',
    currencyCode: 'BRL',
    currencyMinorUnitScale: 2,
    kind: 'expense',
    occurredAt: '2026-11-03T15:30:00.000Z',
    description: 'Mercado',
    observations: null,
    counterpartyId: null,
    counterpartyName: null,
    categoryId: null,
    subcategoryId: null,
    costCenterId: null,
    tagIds: [],
    version,
    lifecycle,
  });
  await page.route(`**/api/accounts/${accountId}`, async (route) =>
    route.fulfill({
      json: {
        account,
        balance: {
          amount: '75.00',
          currencyCode: 'BRL',
          currencyMinorUnitScale: 2,
        },
      },
    }),
  );
  await page.route(
    `**/api/accounts/${accountId}/transactions**`,
    async (route) => {
      const filter = new URL(route.request().url()).searchParams.get(
        'lifecycle',
      );
      const visible =
        filter === 'trashed'
          ? lifecycle === 'trashed'
          : lifecycle !== 'trashed';
      return route.fulfill({ json: visible ? [transaction()] : [] });
    },
  );
  await page.route(
    `**/api/transactions/${transactionId}/lifecycle`,
    async (route) => {
      const { action } = route.request().postDataJSON() as { action: string };
      actions.push(action);
      if (action === 'archive') {
        archived = true;
        lifecycle = 'archived';
      } else if (action === 'unarchive') {
        archived = false;
        lifecycle = 'active';
      } else if (action === 'move-to-trash') {
        lifecycle = 'trashed';
      } else {
        lifecycle = archived ? 'archived' : 'active';
      }
      version += 1;
      return route.fulfill({ json: transaction() });
    },
  );

  await page.goto(`/contas/${accountId}/movimentacoes`);
  await page.getByRole('button', { name: 'Arquivar' }).click();
  await expect(page.getByText('Mercado · Arquivada')).toBeVisible();

  await page.getByRole('button', { name: 'Mover para a lixeira' }).click();
  await expect(
    page.getByText('Ela deixou de afetar os saldos', { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByText('Nenhuma movimentação nesta conta.'),
  ).toBeVisible();

  await page.getByLabel('Mostrar').selectOption('trashed');
  await expect(page.getByText('Mercado · Na lixeira')).toBeVisible();
  await page.getByRole('button', { name: 'Restaurar da lixeira' }).click();
  await expect(
    page.getByText('restaurada ao estado anterior', { exact: false }),
  ).toBeVisible();

  await page.getByLabel('Mostrar').selectOption('ordinary');
  await expect(page.getByText('Mercado · Arquivada')).toBeVisible();
  await page.getByRole('button', { name: 'Desarquivar' }).click();
  await expect(page.getByRole('button', { name: 'Arquivar' })).toBeVisible();

  expect(actions).toEqual([
    'archive',
    'move-to-trash',
    'restore-from-trash',
    'unarchive',
  ]);
});
