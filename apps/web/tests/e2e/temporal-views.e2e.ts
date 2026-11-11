import { expect, test } from '@playwright/test';

type Period = 'day' | 'week' | 'month';

function bounds(date: string, period: Period): { from: string; to: string } {
  const start = new Date(`${date}T03:00:00.000Z`);
  if (period === 'week')
    start.setUTCDate(start.getUTCDate() - start.getUTCDay());
  if (period === 'month') start.setUTCDate(1);
  const end = new Date(start);
  if (period === 'day') end.setUTCDate(end.getUTCDate() + 1);
  if (period === 'week') end.setUTCDate(end.getUTCDate() + 7);
  if (period === 'month') end.setUTCMonth(end.getUTCMonth() + 1);
  return { from: start.toISOString(), to: end.toISOString() };
}

test('navigates day, week, and month with chronological entries and separate currency totals', async ({
  page,
}) => {
  await page.route('**/api/users/me/profile', async (route) => {
    await route.fulfill({ json: { timeZone: 'America/Sao_Paulo' } });
  });
  const requested: { period: Period; date: string }[] = [];
  await page.route('**/api/transactions/temporal?*', async (route) => {
    const url = new URL(route.request().url());
    const period = url.searchParams.get('period') as Period;
    const date = url.searchParams.get('date') ?? '2026-01-01';
    requested.push({ period, date });
    const totals = [
      {
        currencyCode: 'BRL',
        currencyMinorUnitScale: 2,
        income: '15.00',
        expense: '0.00',
      },
      {
        currencyCode: 'USD',
        currencyMinorUnitScale: 2,
        income: '2.00',
        expense: '0.00',
      },
    ];
    await route.fulfill({
      json: {
        period,
        selectedDate: date,
        timeZone: 'America/Sao_Paulo',
        ...bounds(date, period),
        days: [
          {
            date,
            totals,
            transactions: [
              {
                id: 'first',
                accountId: 'account',
                amount: '2.00',
                currencyCode: 'USD',
                currencyMinorUnitScale: 2,
                description: 'Primeira receita',
                kind: 'income',
                occurredAt: `${date}T12:00:00.000Z`,
                timeZone: 'America/Sao_Paulo',
              },
              {
                id: 'second',
                accountId: 'account',
                amount: '15.00',
                currencyCode: 'BRL',
                currencyMinorUnitScale: 2,
                description: 'Segunda receita',
                kind: 'income',
                occurredAt: `${date}T13:00:00.000Z`,
                timeZone: 'Asia/Tokyo',
              },
            ],
          },
        ],
        totals,
      },
    });
  });

  await page.goto('/movimentacoes');
  await expect(
    page.getByText('Datas e horários no fuso America/Sao_Paulo.'),
  ).toBeVisible();
  await expect(page.getByText('09:00')).toBeVisible();
  await expect(page.getByText('22:00 (Asia/Tokyo)')).toBeVisible();
  await expect(page.locator('.temporal-days li')).toContainText([
    'Primeira receita',
    'Segunda receita',
  ]);
  await expect(page.getByText('15,00 BRL').first()).toBeVisible();
  await expect(page.getByText('2,00 USD').first()).toBeVisible();
  await expect.poll(() => requested.length).toBe(1);
  expect(requested[0]?.period).toBe('day');

  await page.getByRole('button', { name: 'Semana' }).click();
  await expect
    .poll(() => requested.some((request) => request.period === 'week'))
    .toBe(true);
  await page.getByRole('button', { name: 'Mês' }).click();
  await expect
    .poll(() => requested.some((request) => request.period === 'month'))
    .toBe(true);
  const monthDate =
    requested.find((request) => request.period === 'month')?.date ?? '';
  await page.getByRole('button', { name: 'Período anterior' }).click();
  await expect
    .poll(
      () => requested.filter((request) => request.period === 'month').length,
    )
    .toBe(2);
  const previous =
    requested.filter((request) => request.period === 'month')[1]?.date ?? '';
  expect(previous).not.toBe(monthDate);
  expect(new Date(`${previous}T12:00:00Z`).getUTCMonth()).toBe(
    (new Date(`${monthDate}T12:00:00Z`).getUTCMonth() + 11) % 12,
  );
});

test('expired session clears the view', async ({ page }) => {
  await page.route('**/api/users/me/profile', async (route) => {
    await route.fulfill({ status: 401, json: { error: 'unauthorized' } });
  });
  await page.goto('/movimentacoes');
  const sessionAlert = page
    .getByRole('alert')
    .filter({ hasText: 'Sua sessão expirou.' });
  await expect(sessionAlert).toBeVisible();
  await expect(sessionAlert).toBeFocused();
});
