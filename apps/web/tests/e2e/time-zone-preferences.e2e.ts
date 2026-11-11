import { expect, test } from '@playwright/test';

test('requires an explicit scope and saves the chosen time zone', async ({
  page,
}) => {
  const saved: unknown[] = [];
  await page.route('**/api/users/me/profile', async (route) => {
    if (route.request().method() === 'PATCH') {
      saved.push(route.request().postDataJSON());
      await route.fulfill({ json: { timeZone: 'Asia/Tokyo' } });
      return;
    }
    await route.fulfill({ json: { timeZone: 'America/Sao_Paulo' } });
  });

  await page.goto('/preferencias');
  await expect(page.getByText('Fuso atual: America/Sao_Paulo.')).toBeVisible();
  const submit = page.getByRole('button', { name: 'Salvar fuso' });
  await expect(submit).toBeDisabled();

  await page.getByLabel('Fuso horário').selectOption('Asia/Tokyo');
  await expect(submit).toBeDisabled();
  await page
    .getByLabel('Aplicar o novo fuso somente às novas movimentações')
    .check();
  await submit.click();

  const confirmation = page.getByText('Fuso atualizado para Asia/Tokyo.');
  await expect(confirmation).toBeVisible();
  await expect(confirmation).toBeFocused();
  expect(saved).toEqual([
    { timeZone: 'Asia/Tokyo', timeZoneChangeScope: 'new_items_only' },
  ]);
  await expect(page.getByText('Fuso atual: Asia/Tokyo.')).toBeVisible();
});

test('reports a concurrent change without claiming success', async ({
  page,
}) => {
  await page.route('**/api/users/me/profile', async (route) => {
    if (route.request().method() === 'PATCH') {
      await route.fulfill({ status: 409, json: { error: 'conflict' } });
      return;
    }
    await route.fulfill({ json: { timeZone: 'America/Sao_Paulo' } });
  });

  await page.goto('/preferencias');
  await page.getByLabel('Fuso horário').selectOption('Asia/Tokyo');
  await page
    .getByLabel('Reinterpretar as movimentações existentes no novo fuso')
    .check();
  await page.getByRole('button', { name: 'Salvar fuso' }).click();

  const alert = page
    .getByRole('alert')
    .filter({ hasText: 'alterado em outra sessão' });
  await expect(alert).toBeVisible();
  await expect(alert).toBeFocused();
  await expect(page.getByText('Fuso atual: America/Sao_Paulo.')).toBeVisible();
});

test('expired session does not show the form', async ({ page }) => {
  await page.route('**/api/users/me/profile', async (route) => {
    await route.fulfill({ status: 401, json: { error: 'unauthorized' } });
  });

  await page.goto('/preferencias');

  await expect(
    page.getByRole('alert').filter({ hasText: 'Sua sessão expirou.' }),
  ).toBeVisible();
  await expect(page.getByLabel('Fuso horário')).toHaveCount(0);
});
