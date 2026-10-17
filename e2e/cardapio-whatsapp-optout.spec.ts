import { expect, test } from '@playwright/test';

test('descadastro exige confirmação e remove a capability da URL antes de enviar', async ({ page }) => {
  const requests: Array<{ method: string; token: string }> = [];
  await page.route('**/api/cardapio/whatsapp/opt-out', async route => {
    requests.push({ method: route.request().method(), token: route.request().postDataJSON().token });
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{"disabled":true}' });
  });
  await page.goto('/whatsapp/avisos#token=synthetic-test-capability');
  await expect(page.getByRole('heading', { name: 'Parar avisos pelo WhatsApp' })).toBeVisible();
  await expect(page).toHaveURL(/\/whatsapp\/avisos$/);
  expect(requests).toHaveLength(0);
  await page.getByRole('button', { name: 'Parar avisos deste restaurante' }).click();
  await expect(page.getByRole('heading', { name: 'Avisos desativados' })).toBeVisible();
  expect(requests).toEqual([{ method: 'POST', token: 'synthetic-test-capability' }]);
});

test('link sem capability não permite descadastro', async ({ page }) => {
  await page.goto('/whatsapp/avisos');
  await expect(page.getByRole('alert')).toHaveText('Abra o link de descadastro recebido na mensagem.');
  await expect(page.getByRole('button', { name: 'Parar avisos deste restaurante' })).toHaveCount(0);
});

test('link compacto continua no fragmento e exige POST explícito', async ({ page }) => {
  const compact = 'A'.repeat(76); // Somente formato sintético; sem capability verdadeira.
  const seen: Array<{ method: string; path: string; token: string }> = [];
  await page.route('**/api/cardapio/whatsapp/opt-out', async route => {
    const request = route.request();
    seen.push({ method: request.method(), path: new URL(request.url()).pathname,
      token: request.postDataJSON().token });
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{"disabled":true}' });
  });
  await page.goto(`/whatsapp/avisos#token=${compact}`);
  await expect(page).toHaveURL(/\\/whatsapp\\/avisos$/);
  expect(seen).toEqual([]);
  await page.getByRole('button', { name: 'Parar avisos deste restaurante' }).click();
  await expect(page.getByRole('heading', { name: 'Avisos desativados' })).toBeVisible();
  expect(seen).toEqual([{ method: 'POST', path: '/api/cardapio/whatsapp/opt-out', token: compact }]);
});
