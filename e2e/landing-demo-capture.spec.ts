import { test, expect } from '@playwright/test';

test('demo persists contact, handles failure and confirms receipt without opening WhatsApp', async ({ page }) => {
  let attempts = 0;
  let payload: Record<string, unknown> = {};
  await page.route('**/api/leads/landing', async route => {
    payload = route.request().postDataJSON();
    attempts++;
    await route.fulfill({ status: attempts === 1 ? 503 : 201,
      contentType: 'application/json', body: JSON.stringify(attempts === 1 ? {} : { success: true }) });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'QUERO VER UMA DEMONSTRAÇÃO', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('SEU NOME', { exact: true }).fill('Cliente de teste');
  await dialog.getByLabel('NOME DO ESTABELECIMENTO').fill('Restaurante de teste');
  await dialog.getByLabel('WHATSAPP COM DDD').fill('85999998888');
  await dialog.getByRole('checkbox').check();
  await dialog.getByRole('button', { name: 'SOLICITAR DEMONSTRAÇÃO' }).click();
  await expect(dialog.getByRole('alert')).toBeVisible();
  await expect(dialog.getByLabel('SEU NOME', { exact: true })).toHaveValue('Cliente de teste');
  await dialog.getByRole('button', { name: 'SOLICITAR DEMONSTRAÇÃO' }).click();
  await expect(dialog.getByRole('status')).toContainText('Pedido de demonstração recebido');
  expect(payload).toMatchObject({ nome: 'Cliente de teste', empresa_nome: 'Restaurante de teste', whatsapp: '85999998888', consent_whatsapp: true });
  expect(page.context().pages()).toHaveLength(1);
});
