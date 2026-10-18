import { expect, test } from '@playwright/test';

// Browser contract journeys use synthetic route fixtures. Provider token expiry,
// replay, and confirmation must also be verified against a real Supabase stack.
const email = 'conta@example.test';
const password = 'Synthetic-password-123';

test('confirmed account signs in while missing and revoked sessions are denied', async ({
  page,
}) => {
  let confirmed = false;
  let active = false;
  let loginAttempts = 0;
  await page.route('**/api/auth/registrations', async (route) => {
    expect(route.request().postDataJSON()).toEqual({
      displayName: 'Pessoa Sintética',
      email,
      password,
    });
    await route.fulfill({ status: 202, body: '' });
  });
  await page.route('**/api/auth/sessions', async (route) => {
    const method = route.request().method();
    if (method === 'GET') {
      await route.fulfill({ status: active ? 204 : 401, body: '' });
      return;
    }
    if (method === 'DELETE') {
      active = false;
      await route.fulfill({ status: 204, body: '' });
      return;
    }
    const credentials = route.request().postDataJSON() as Record<
      string,
      unknown
    >;
    expect(credentials).toEqual({ email, password });
    loginAttempts += 1;
    active = confirmed;
    await route.fulfill({ status: active ? 204 : 401, body: '' });
  });

  await page.goto('/cadastro');
  await page.getByRole('textbox', { name: 'Nome' }).fill('Pessoa Sintética');
  await page.getByRole('textbox', { name: 'E-mail' }).fill(email);
  await page.getByLabel('Senha').fill(password);
  await page.getByRole('button', { name: 'Criar conta' }).click();
  await expect(page.getByRole('status')).toContainText('Confira seu e-mail.');

  await page.goto('/entrar');
  await expect(page.getByRole('button', { name: 'Entrar' })).toBeVisible();
  await page.getByRole('textbox', { name: 'E-mail' }).fill(email);
  await page.getByLabel('Senha').fill(password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(
    page.getByRole('alert').filter({ hasText: 'Não foi possível entrar.' }),
  ).toContainText('Não foi possível entrar.');

  confirmed = true; // Synthetic provider confirmation, outside this browser journey.
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Sessão ativa.' }),
  ).toBeVisible();
  expect(loginAttempts).toBe(2);
  await page.getByRole('button', { name: 'Sair' }).click();
  await expect(page.getByRole('button', { name: 'Entrar' })).toBeVisible();
  await page.getByRole('textbox', { name: 'E-mail' }).fill(email);
  await page.getByLabel('Senha').fill(password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByText('Sessão ativa.')).toBeVisible();
  active = false; // Simulate a revoked or expired server session.
  await page.reload();
  await expect(page.getByRole('button', { name: 'Entrar' })).toBeVisible();
  await expect(page.getByText('Sessão ativa.')).toHaveCount(0);
});

test('progressive login denials expose one generic error to the user', async ({
  page,
}) => {
  let attempts = 0;
  await page.route('**/api/auth/sessions', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ status: 401, body: '' });
      return;
    }
    attempts += 1;
    await route.fulfill({ status: attempts < 3 ? 401 : 429, body: '' });
  });
  await page.goto('/entrar');
  await page.getByRole('textbox', { name: 'E-mail' }).fill(email);
  await page.getByLabel('Senha').fill(password);
  for (let index = 0; index < 3; index += 1) {
    await page.getByRole('button', { name: 'Entrar' }).click();
    await expect(
      page.getByRole('alert').filter({ hasText: 'Não foi possível entrar.' }),
    ).toHaveText(
      'Não foi possível entrar. Confira os dados e tente novamente.',
    );
  }
  expect(attempts).toBe(3);
});

test('password recovery uses the same accessible response for known and unknown addresses', async ({
  page,
}) => {
  const submitted: string[] = [];
  await page.route('**/api/auth/password-recovery-requests', async (route) => {
    const input = route.request().postDataJSON() as { email: string };
    submitted.push(input.email);
    await route.fulfill({ status: 202, body: '' });
  });
  for (const address of [email, 'unknown@example.test']) {
    await page.goto('/recuperar-senha');
    await page.getByRole('textbox', { name: 'E-mail' }).fill(address);
    await page.getByRole('button', { name: 'Enviar instruções' }).click();
    const status = page
      .getByRole('status')
      .filter({ hasText: 'Confira seu e-mail.' });
    await expect(status).toContainText(
      'Se o endereço estiver cadastrado, você receberá instruções para redefinir a senha.',
    );
    await expect(status).toBeFocused();
  }
  expect(submitted).toEqual([email, 'unknown@example.test']);
});

test('mocked expired and replayed recovery proofs are rejected and link token leaves the URL', async ({
  page,
}) => {
  const expiredToken = 'expired-synthetic-proof';
  const validToken = 'valid-synthetic-proof';
  const submitted: string[] = [];
  let used = false;
  await page.route(
    '**/api/auth/password-recovery-completions',
    async (route) => {
      const input = route.request().postDataJSON() as { tokenHash: string };
      submitted.push(input.tokenHash);
      const status = input.tokenHash === expiredToken || used ? 400 : 204;
      if (status === 204) used = true;
      await route.fulfill({ status, body: '' });
    },
  );
  async function submitProof(token: string): Promise<void> {
    await page.goto('/recuperar-senha');
    await page.goto(`/auth/reset-password#token_hash=${token}`);
    await expect(page).toHaveURL(/\/auth\/reset-password$/u);
    await page
      .getByLabel('Nova senha', { exact: true })
      .fill('New-synthetic-password-123');
    await page
      .getByLabel('Confirme a nova senha')
      .fill('New-synthetic-password-123');
    await page.getByRole('button', { name: 'Redefinir senha' }).click();
  }
  await submitProof(expiredToken);
  await expect(
    page.getByRole('alert').filter({ hasText: 'Este link é inválido' }),
  ).toContainText('Este link é inválido, expirou ou já foi usado.');
  await submitProof(validToken);
  await expect(page.getByRole('status')).toContainText('Senha redefinida.');
  await submitProof(validToken);
  await expect(
    page.getByRole('alert').filter({ hasText: 'Este link é inválido' }),
  ).toContainText('Este link é inválido, expirou ou já foi usado.');
  expect(submitted).toEqual([expiredToken, validToken, validToken]);
});
