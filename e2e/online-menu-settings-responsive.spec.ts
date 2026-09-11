import { expect, Page, test } from '@playwright/test';

import { mockCashierBackend, seedCashierSession } from './fixtures/cashier';

const profile = {
  id: 2,
  nome: 'Restaurante E2E',
  subtitulo: 'Cardápio enxuto e direto',
  sobre_nos: 'Restaurante usado na homologação responsiva.',
  endereco: 'Rua Central, 100 - Centro',
  google_maps_url: 'https://maps.google.com/?q=restaurante-e2e',
  status_override: 'Forçado Aberto',
  logo_url: '',
  banner_url: '',
  socials: { whatsapp: '85999999999', instagram: '@restaurantee2e' },
  horarios_funcionamento: [{ days: 'Segunda a Sexta', hours: '11:00 - 23:00' }],
  formas_pagamento_aceitas: ['Pix', 'Dinheiro'],
  pedido_minimo: 20,
  frete_gratis_valor: 80,
  tipo_taxa_entrega: 'fixa',
  taxa_entrega_fixa: 6,
  tabela_taxas_bairros: [],
  delivery_ativo: true,
};

async function expectNoHorizontalOverflow(page: Page) {
  const widths = await page.evaluate(() => ({
    viewport: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    bodyWidth: document.body.scrollWidth,
  }));
  expect(widths.documentWidth).toBeLessThanOrEqual(widths.viewport + 1);
  expect(widths.bodyWidth).toBeLessThanOrEqual(widths.viewport + 1);
}

async function setup(page: Page, theme: 'dark' | 'light') {
  await page.route('https://fonts.googleapis.com/**', route => route.fulfill({ contentType: 'text/css', body: '' }));
  await mockCashierBackend(page);
  await seedCashierSession(page);
  await page.addInitScript((nextTheme) => {
    localStorage.setItem('@koma:theme', nextTheme);
  }, theme);
  await page.routeWebSocket(/\/ws\//, socket => socket.onMessage(() => {}));

  await page.route('**/api/cardapio-digital/config', async route => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ json: profile });
      return;
    }
    const payload = route.request().postDataJSON() || {};
    await route.fulfill({ json: { ...profile, ...payload } });
  });
  await page.route('**/api/restaurant-features/scheduled-orders', async route => {
    const payload = route.request().postDataJSON() || {};
    await route.fulfill({ json: { enabled: Boolean(payload.enabled) } });
  });
}

async function navigate(page: Page, label: string) {
  const sidebar = page.locator('.cashier-sidebar:visible');
  if (!await sidebar.isVisible()) {
    await page.getByRole('button', { name: 'Abrir menu principal' }).click();
    await expect(page.locator('.cashier-sidebar:visible')).toBeVisible();
  }
  await page.locator('.cashier-sidebar:visible')
    .getByRole('button', { name: new RegExp(`^${label}(?: \\d+)?$`) })
    .first()
    .click();
  await expect(page.locator('#mobile-caixa-sidebar')).not.toBeVisible();
}

function cashierSubnavButton(page: Page, name: string) {
  return page.locator('.cashier-subnav').getByRole('button', { name, exact: true });
}

async function openOnlineMenu(page: Page, theme: 'dark' | 'light') {
  await setup(page, theme);
  await page.goto('/?view=caixa');
  await expect(page.locator('html')).toHaveAttribute('data-koma-theme', theme);
  await navigate(page, 'Cardápio online');
  await expect(page.locator('.cashier-topbar h2')).toHaveText(/Configurações do cardápio online/i);
}

const mobileViewports = [
  { width: 360, height: 800 },
  { width: 390, height: 844 },
  { width: 412, height: 915 },
] as const;

for (const theme of ['dark', 'light'] as const) {
  for (const viewport of mobileViewports) {
    test(`cardápio online mantém hierarquia enxuta em ${viewport.width}x${viewport.height} no tema ${theme}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await openOnlineMenu(page, theme);

      for (const label of ['Loja', 'Operação', 'Divulgação']) {
        const button = cashierSubnavButton(page, label);
        await expect(button).toBeVisible();
        const box = await button.boundingBox();
        expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
      }
      await expect(page.locator('.cashier-subnav').getByRole('button', { name: /Cupons|Fidelidade/i })).toHaveCount(0);

      await expect(page.getByRole('heading', { name: 'Perfil do cardápio', exact: true })).toBeVisible();
      await expect(page.getByText('Informações principais', { exact: true })).toBeVisible();
      const additional = page.locator('details').filter({ hasText: 'Informações adicionais' });
      await expect(additional).toBeVisible();
      await expect(additional).not.toHaveAttribute('open', '');

      await page.getByRole('button', { name: 'Marca', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Marca', exact: true })).toBeVisible();
      await expectNoHorizontalOverflow(page);

      await cashierSubnavButton(page, 'Operação').click();
      await expect(page.getByRole('heading', { name: 'Pedidos e horários', exact: true })).toBeVisible();
      for (const label of ['Pedidos & horários', 'Entrega & áreas', 'Pagamentos']) {
        await expect(page.getByRole('button', { name: label, exact: true })).toBeVisible();
      }
      const protections = page.locator('details').filter({ hasText: 'Proteções operacionais' });
      await expect(protections).toBeVisible();
      await expect(protections).not.toHaveAttribute('open', '');
      await expectNoHorizontalOverflow(page);

      await page.getByRole('button', { name: 'Entrega & áreas', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Entrega', exact: true })).toBeVisible();
      await expect(page.getByText('Como cobrar a entrega', { exact: true })).toBeVisible();
      await expectNoHorizontalOverflow(page);

      await page.getByRole('button', { name: 'Pagamentos', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Pagamentos', exact: true })).toBeVisible();
      await expect(page.getByText('Formas aceitas', { exact: true })).toBeVisible();
      await expectNoHorizontalOverflow(page);

      await cashierSubnavButton(page, 'Divulgação').click();
      await expect(page.getByRole('heading', { name: 'Link e QR Code', exact: true })).toBeVisible();
      await expectNoHorizontalOverflow(page);

      const stickySaveBars = page.locator('[class*="sticky"]').filter({ hasText: /Salvar e publicar|Tudo salvo/i });
      await expect(stickySaveBars).toHaveCount(0);
      await expect(page.getByText('Tudo salvo', { exact: true })).toHaveCount(0);
    });
  }
}
