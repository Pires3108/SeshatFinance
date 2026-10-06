import { expect, test } from '@playwright/test';

const id = 'c15a5404-7f4e-4f4b-a2d8-cb00f406d63a';
const balance = {
  amount: '1234.50',
  currencyCode: 'BRL',
  currencyMinorUnitScale: 2,
};

test('empty account list gives a clear accessible state', async ({ page }) => {
  await page.route('**/api/accounts?lifecycle=active', async (route) => {
    await route.fulfill({ json: [] });
  });
  await page.goto('/contas');
  await expect(page.getByRole('heading', { name: 'Contas' })).toBeVisible();
  await expect(page.getByRole('status')).toContainText(
    'Nenhuma conta nesta seção.',
  );
});

test('created account appears once in list and detail with its API balance', async ({
  page,
}) => {
  const account = {
    id,
    name: 'Minha conta',
    typeKey: 'checking-account',
    lifecycle: 'active',
    currencyCode: 'BRL',
    currencyMinorUnitScale: 2,
  };
  await page.route('**/api/accounts?lifecycle=active', async (route) => {
    await route.fulfill({ json: [{ account, balance }] });
  });
  await page.route(`**/api/accounts/${id}`, async (route) => {
    await route.fulfill({ json: { account, balance } });
  });
  await page.goto('/contas');
  await expect(page.getByRole('listitem')).toHaveCount(1);
  await expect(page.getByRole('listitem')).toContainText('1.234,50 BRL');
  await page.getByRole('link', { name: 'Minha conta' }).click();
  await expect(
    page.getByRole('heading', { name: 'Minha conta' }),
  ).toBeVisible();
  await expect(page.getByText('1.234,50 BRL')).toBeVisible();
});

test('archived account returns to archived state after trash restoration', async ({
  page,
}) => {
  let lifecycle: 'archived' | 'trashed' = 'archived';
  const account = {
    id,
    name: 'Reserva familiar',
    typeKey: 'savings-account',
    currencyCode: 'BRL',
    currencyMinorUnitScale: 2,
  };
  await page.route('**/api/accounts**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/lifecycle')) {
      const body = route.request().postDataJSON() as { action: string };
      lifecycle = body.action === 'move-to-trash' ? 'trashed' : 'archived';
      await route.fulfill({ json: { lifecycle } });
    } else if (url.searchParams.has('lifecycle')) {
      await route.fulfill({
        json:
          url.searchParams.get('lifecycle') === lifecycle
            ? [{ account: { ...account, lifecycle }, balance }]
            : [],
      });
    } else {
      await route.fulfill({
        json: { account: { ...account, lifecycle }, balance },
      });
    }
  });
  page.on('dialog', (dialog) => {
    void dialog.accept();
  });
  await page.goto('/contas');
  await page.getByRole('button', { name: 'Arquivadas' }).click();
  await expect(page.getByRole('listitem')).toHaveCount(1);
  await page.getByRole('button', { name: 'Mover para a lixeira' }).click();
  await expect(page.getByRole('status')).toContainText(
    'Nenhuma conta nesta seção.',
  );
  await expect(page.getByRole('status')).toBeFocused();
  await page.getByRole('button', { name: 'Lixeira' }).click();
  await page.getByRole('button', { name: 'Restaurar da lixeira' }).click();
  await page.getByRole('button', { name: 'Arquivadas' }).click();
  await expect(page.getByRole('listitem')).toContainText('Arquivada');
  await expect(page.getByRole('listitem')).toContainText('1.234,50 BRL');
});

test('expired session removes financial data from account detail', async ({
  page,
}) => {
  await page.route(`**/api/accounts/${id}`, async (route) => {
    await route.fulfill({ status: 401, json: { error: 'unauthorized' } });
  });
  await page.goto(`/contas/${id}`);
  const message = page
    .getByRole('alert')
    .filter({ hasText: 'Seu acesso expirou.' });
  await expect(message).toBeVisible();
  await expect(message).toBeFocused();
  await expect(page.getByText('Saldo contábil')).toHaveCount(0);
});

for (const status of [403, 404]) {
  test(`detail handles ${String(status)} with a focused safe next step`, async ({
    page,
  }) => {
    await page.route(`**/api/accounts/${id}`, async (route) => {
      await route.fulfill({ status, json: { error: 'unavailable' } });
    });
    await page.goto(`/contas/${id}`);
    const message = page.locator('main').getByRole('alert');
    await expect(message).toBeFocused();
    await expect(
      message.getByRole('link', { name: 'Voltar às contas' }),
    ).toBeVisible();
    await expect(page.getByText('Saldo contábil')).toHaveCount(0);
  });
}

test('network failure supports keyboard retry and restores readable results', async ({
  page,
}) => {
  let retry = false;
  await page.route('**/api/accounts?lifecycle=active', async (route) => {
    if (!retry) {
      await route.abort('failed');
    } else await route.fulfill({ json: [] });
  });
  await page.goto('/contas');
  await expect(page.locator('main').getByRole('alert')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(
    page.getByRole('button', { name: 'Tentar novamente' }),
  ).toBeFocused();
  retry = true;
  await page.keyboard.press('Enter');
  await expect(page.getByRole('status')).toContainText(
    'Nenhuma conta nesta seção.',
  );
});

test('switching filters cancels an older account request', async ({ page }) => {
  let activeRequested = false;
  let activeCancelled = false;
  page.on('requestfailed', (request) => {
    if (request.url().endsWith('/api/accounts?lifecycle=active'))
      activeCancelled = true;
  });
  await page.route('**/api/accounts?lifecycle=active', async (route) => {
    activeRequested = true;
    await new Promise((resolve) => setTimeout(resolve, 500));
    await route.fulfill({ json: [] }).catch(() => undefined);
  });
  await page.route('**/api/accounts?lifecycle=archived', async (route) => {
    await route.fulfill({ json: [] });
  });
  await page.goto('/contas');
  await expect.poll(() => activeRequested).toBe(true);
  await page.getByRole('button', { name: 'Arquivadas' }).click();
  await expect.poll(() => activeCancelled).toBe(true);
  await expect(page.getByRole('status')).toContainText(
    'Nenhuma conta nesta seção.',
  );
  await expect(
    page.getByRole('button', { name: 'Arquivadas' }),
  ).toHaveAttribute('aria-pressed', 'true');
});
