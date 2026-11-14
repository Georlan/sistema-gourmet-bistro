import { expect, test } from '@playwright/test';
import { mockCashierBackend, seedCashierSession } from './fixtures/cashier';

test('Pix próprio exige aceite, preserva o escopo e envia chave para o contrato existente', async ({ page }) => {
  await mockCashierBackend(page);
  let body: Record<string, unknown> | undefined;
  await page.route('**/payments/direct-pix/settings', async route => {
    if (route.request().method() === 'PUT') {
      body = route.request().postDataJSON();
      return route.fulfill({ json: { ...body, available: true } });
    }
    return route.fulfill({ json: { available: true, enabled: false, key_type: 'email', pix_key: '', holder_name: '', city: '', commercial: null, test_mode: true } });
  });
  await seedCashierSession(page);
  await page.goto('/?view=caixa');
  await expect(page.locator('.cashier-topbar')).toBeVisible();
  if (!await page.locator('.cashier-sidebar:visible').isVisible()) await page.getByRole('button', { name: 'Abrir menu principal' }).click();
  await page.locator('.cashier-sidebar:visible').getByRole('button', { name: /^Configurações/ }).first().click();
  await page.locator('.cashier-subnav').getByRole('button', { name: 'Integrações', exact: true }).click();
  const section = page.getByRole('region', { name: 'Pix com chave própria' });
  await expect(section).toBeVisible();
  await expect(section).toContainText('valor de cada pedido do Cardápio Online');
  await expect(section).toContainText('Modo teste: Pix pagos transferem dinheiro real.');
  await expect(section).not.toContainText('Um comprovante, sozinho');
  await section.getByLabel('Chave Pix', { exact: true }).fill('conta@example.test');
  await section.getByLabel('Nome do recebedor').fill('Restaurante Teste');
  await section.getByLabel('Cidade do recebedor').fill('Fortaleza');
  const save = section.getByRole('button', { name: 'Ativar Pix próprio' });
  await expect(save).toBeDisabled();
  await section.getByRole('checkbox').check();
  await save.click();
  await expect(section.getByRole('status')).toContainText('Pix próprio ativo');
  expect(body).toEqual({ enabled: true, key_type: 'email', pix_key: 'conta@example.test', holder_name: 'Restaurante Teste', city: 'Fortaleza', accept_manual_confirmation_and_monthly_fees: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});
