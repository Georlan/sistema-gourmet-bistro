import { expect, test } from '@playwright/test';

test('reset remove o segredo da URL e confirma a nova senha sem autenticar automaticamente', async ({ page }) => {
  const requests: unknown[] = [];
  await page.route('http://127.0.0.1:8000/**', async route => {
    if (route.request().url().endsWith('/auth/password-recovery/confirm')) {
      requests.push(route.request().postDataJSON());
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ message: 'Senha alterada. Entre novamente com sua nova senha.' }) });
    }
    return route.fulfill({ contentType: 'application/json', body: '{}' });
  });
  await page.goto('/recuperar-senha#token=opaque-test-secret');
  await expect(page.getByRole('heading', { name: 'Criar nova senha' })).toBeVisible();
  await expect(page).toHaveURL(/\/recuperar-senha$/);
  await page.getByLabel('Nova senha', { exact: true }).fill('new-test-password');
  await page.getByLabel('Confirme a nova senha', { exact: true }).fill('different-password');
  await page.getByRole('button', { name: 'Salvar nova senha' }).click();
  await expect(page.getByRole('status')).toHaveText('As senhas precisam ser iguais.');
  expect(requests).toHaveLength(0);
  await page.getByLabel('Confirme a nova senha', { exact: true }).fill('new-test-password');
  await page.getByRole('button', { name: 'Salvar nova senha' }).click();
  await expect(page.getByRole('status')).toContainText('Senha alterada');
  expect(requests).toEqual([{ token: 'opaque-test-secret', password: 'new-test-password' }]);
  expect(await page.evaluate(() => Object.values(localStorage).some(value => String(value).includes('opaque-test-secret')))).toBe(false);
});

test('reset sem link não oferece troca de senha', async ({ page }) => {
  await page.goto('/recuperar-senha');
  await expect(page.getByText(/Abra o link enviado ao seu e-mail/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Salvar nova senha' })).toHaveCount(0);
});
