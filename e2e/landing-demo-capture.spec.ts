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

test('landing SEO is readable without horizontal overflow and mobile navigation adapts', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'SISTEMA PARA RESTAURANTES' })).toBeVisible();
  for (const width of [360, 390, 768, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
      `landing must not overflow horizontally at ${width}px`).toBe(true);
    for (const selector of ['body', '.koma-hero', '.koma-management-section', '.koma-footer', '.koma-header']) {
      const bounds = await page.locator(selector).boundingBox();
      expect(bounds, `${selector} must be measurable at ${width}px`).not.toBeNull();
      expect(bounds!.width, `${selector} must fit within ${width}px`).toBeLessThanOrEqual(width + 1);
    }
    if (width <= 768) {
      await expect(page.locator('.koma-header-nav')).toBeHidden();
      await expect(page.getByRole('button', { name: 'Abrir menu' })).toBeVisible();
    } else {
      await expect(page.locator('.koma-header-nav')).toBeVisible();
      await expect(page.locator('.koma-hamburger')).toBeHidden();
    }
  }
});

test('Instagram acquisition remains attributed to CRM lead after product tour hash changes', async ({ page }) => {
  let submitted: Record<string, unknown> | null = null;
  await page.route('**/api/leads/landing', async route => {
    submitted = route.request().postDataJSON();
    await route.fulfill({ status: 201, contentType: 'application/json',
      body: JSON.stringify({ success: true, deduplicated: false }) });
  });
  await page.goto('/?utm_source=instagram&utm_medium=organic_social&utm_campaign=perfil');
  await page.getByRole('tab', { name: /Cardápio/ }).click();
  await page.getByRole('button', { name: 'QUERO VER UMA DEMONSTRAÇÃO', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('SEU NOME', { exact: true }).fill('Cliente Teste');
  await dialog.getByLabel('NOME DO ESTABELECIMENTO').fill('Restaurante');
  await dialog.getByLabel('WHATSAPP COM DDD').fill('85999998888');
  await dialog.getByRole('checkbox').check();
  await dialog.getByRole('button', { name: 'SOLICITAR DEMONSTRAÇÃO' }).click();
  await expect(dialog.getByRole('status')).toContainText('Pedido de demonstração recebido');
  expect(submitted?.interesse).toContain('origem: instagram');
  expect(JSON.stringify(submitted)).not.toContain('utm_campaign');
});
