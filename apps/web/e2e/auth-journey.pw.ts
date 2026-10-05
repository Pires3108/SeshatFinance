import { expect, test, type Page } from '@playwright/test';

const syntheticEmail = 'conta@example.test';
const syntheticPassword = 'Example-password-123';

interface FakeIdentity {
  registered: boolean;
  confirmed: boolean;
  signedIn: boolean;
  expired: boolean;
  registrationRequests: number;
  loginRequests: number;
  logoutRequests: number;
  recoveryRequests: number;
}

async function useFakeIdentity(page: Page): Promise<FakeIdentity> {
  const identity: FakeIdentity = {
    registered: false,
    confirmed: false,
    signedIn: false,
    expired: false,
    registrationRequests: 0,
    loginRequests: 0,
    logoutRequests: 0,
    recoveryRequests: 0,
  };

  await page.route('**/api/auth/registrations', async (route) => {
    const input = route.request().postDataJSON() as Record<string, unknown>;
    expect(input.email).toBe(syntheticEmail);
    expect(input.password).toBe(syntheticPassword);
    identity.registrationRequests += 1;
    identity.registered = true;
    await route.fulfill({
      status: 202,
      contentType: 'application/json',
      body: JSON.stringify({ status: 'confirmation_required' }),
    });
  });

  await page.route('**/api/auth/sessions', async (route) => {
    const method = route.request().method();
    if (method === 'GET') {
      await route.fulfill({
        status: identity.signedIn && !identity.expired ? 204 : 401,
        body: '',
      });
      return;
    }
    if (method === 'POST') {
      identity.loginRequests += 1;
      const input = route.request().postDataJSON() as Record<string, unknown>;
      const valid =
        identity.registered &&
        identity.confirmed &&
        input.email === syntheticEmail &&
        input.password === syntheticPassword;
      if (valid) {
        identity.signedIn = true;
        identity.expired = false;
      }
      await route.fulfill({
        status: valid ? 204 : 401,
        contentType: 'application/json',
        body: valid ? '' : JSON.stringify({ error: 'invalid_credentials' }),
      });
      return;
    }
    if (method === 'DELETE') {
      identity.logoutRequests += 1;
      identity.signedIn = false;
      await route.fulfill({ status: 204, body: '' });
      return;
    }
    throw new Error(`Unexpected auth method: ${method}`);
  });

  await page.route('**/api/auth/password-recovery-requests', async (route) => {
    identity.recoveryRequests += 1;
    await route.fulfill({
      status: 202,
      contentType: 'application/json',
      body: JSON.stringify({ status: 'accepted' }),
    });
  });

  return identity;
}

test('registration confirmation leads to login, logout, and expired-session handling', async ({
  page,
}) => {
  const identity = await useFakeIdentity(page);

  await page.goto('/cadastro');
  await expect(
    page.getByRole('heading', { name: 'Criar conta' }),
  ).toBeVisible();
  await page.getByRole('textbox', { name: 'Nome' }).fill('Pessoa de Teste');
  await page.getByRole('textbox', { name: 'E-mail' }).fill(syntheticEmail);
  await page.getByLabel('Senha').fill(syntheticPassword);
  await page.getByRole('button', { name: 'Criar conta' }).click();
  const confirmation = page.getByRole('status').filter({
    hasText: 'Confira seu e-mail.',
  });
  await expect(confirmation).toBeVisible();
  await expect(confirmation).toBeFocused();
  expect(identity.registrationRequests).toBe(1);

  await page.goto('/entrar');
  await expect(page.getByRole('button', { name: 'Entrar' })).toBeVisible();
  await page.getByRole('textbox', { name: 'E-mail' }).fill(syntheticEmail);
  await page.getByLabel('Senha').fill(syntheticPassword);
  await page.getByRole('button', { name: 'Entrar' }).click();
  const unconfirmedError = page.getByRole('alert').filter({
    hasText: 'Não foi possível entrar.',
  });
  await expect(unconfirmedError).toHaveText(
    'Não foi possível entrar. Confira os dados e tente novamente.',
  );
  await expect(unconfirmedError).toBeFocused();

  // Email confirmation is performed outside the web app by the identity provider.
  identity.confirmed = true;
  await page.getByRole('button', { name: 'Entrar' }).click();
  const activeSession = page.getByRole('status').filter({
    hasText: 'Sessão ativa.',
  });
  await expect(activeSession).toBeVisible();
  await expect(activeSession).toBeFocused();
  expect(identity.loginRequests).toBe(2);

  await page.getByRole('button', { name: 'Sair' }).click();
  await expect(page.getByRole('button', { name: 'Entrar' })).toBeVisible();
  expect(identity.logoutRequests).toBe(1);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Entrar' })).toBeVisible();

  await page.getByRole('textbox', { name: 'E-mail' }).fill(syntheticEmail);
  await page.getByLabel('Senha').fill(syntheticPassword);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(activeSession).toBeVisible();
  identity.expired = true;
  await page.reload();
  await expect(page.getByRole('button', { name: 'Entrar' })).toBeVisible();
  await expect(activeSession).toHaveCount(0);
});

test('recovery gives the same accessible response for existing and unknown addresses', async ({
  page,
}) => {
  const identity = await useFakeIdentity(page);
  for (const email of [syntheticEmail, 'desconhecida@example.test']) {
    await page.goto('/recuperar-senha');
    await page.getByRole('textbox', { name: 'E-mail' }).fill(email);
    await page.getByRole('button', { name: 'Enviar instruções' }).click();
    const message = page.getByRole('status').filter({
      hasText: 'Confira seu e-mail.',
    });
    await expect(message).toHaveText(
      /Se o endereço estiver cadastrado, você receberá instruções para redefinir a senha/u,
    );
    await expect(message).toBeFocused();
  }
  expect(identity.recoveryRequests).toBe(2);
});

test('registration exposes labels and returns focus to a failed submission', async ({
  page,
}) => {
  await page.route('**/api/auth/registrations', async (route) => {
    await route.fulfill({ status: 503, body: '' });
  });
  await page.goto('/cadastro');
  await page.getByRole('link', { name: 'Pular para o conteúdo' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('main')).toBeFocused();
  await page.getByRole('textbox', { name: 'Nome' }).fill('Pessoa de Teste');
  await page.getByRole('textbox', { name: 'E-mail' }).fill(syntheticEmail);
  await page.getByLabel('Senha').fill(syntheticPassword);
  await page.getByRole('button', { name: 'Criar conta' }).click();
  const error = page.getByRole('alert').filter({
    hasText: 'Não foi possível enviar o cadastro.',
  });
  await expect(error).toHaveText(
    /Não foi possível enviar o cadastro. Confira os dados e tente novamente/u,
  );
  await expect(error).toBeFocused();
});

test('password reset removes the link token from the address and handles reuse', async ({
  page,
}) => {
  const token = 'synthetic-recovery-token';
  let used = false;
  let attempts = 0;
  await page.route(
    '**/api/auth/password-recovery-completions',
    async (route) => {
      const input = route.request().postDataJSON() as Record<string, unknown>;
      expect(input.tokenHash).toBe(token);
      const status = attempts === 0 ? 503 : used ? 400 : 204;
      attempts += 1;
      await route.fulfill({ status, body: '' });
      if (status === 204) used = true;
    },
  );

  await page.goto(`/auth/reset-password#token_hash=${token}`);
  await expect(page).toHaveURL(/\/auth\/reset-password$/u);
  await page.locator('#new-password').fill('new-synthetic-password');
  await page.getByRole('button', { name: 'Redefinir senha' }).click();
  const retryable = page.getByRole('alert').filter({
    hasText: 'Não foi possível redefinir a senha.',
  });
  await expect(retryable).toBeFocused();
  await page.getByRole('button', { name: 'Redefinir senha' }).click();
  const success = page.getByRole('status').filter({
    hasText: 'Senha redefinida.',
  });
  await expect(success).toBeFocused();
  await expect(success).toContainText('Senha redefinida.');

  await page.goto(`/auth/reset-password#token_hash=${token}`);
  await page.reload();
  await page.locator('#new-password').fill('another-synthetic-password');
  await page.getByRole('button', { name: 'Redefinir senha' }).click();
  const invalid = page.getByRole('alert').filter({
    hasText: 'O link é inválido ou expirou.',
  });
  await expect(invalid).toBeFocused();
  await expect(page).toHaveURL(/\/auth\/reset-password$/u);
});
