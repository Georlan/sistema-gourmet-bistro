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
    if (route.request().method() === 'GET') {
      await route.fulfill({ json: { enabled: false } });
      return;
    }
    const payload = route.request().postDataJSON() || {};
    await route.fulfill({ json: { enabled: Boolean(payload.enabled) } });
  });
  await page.route('**/caixa/configuracoes/delivery-suggestion', route => route.fulfill({
    json: {
      taxa_minima: 5,
      valor_por_km: 1,
      source: 'default',
      sample_size: 0,
      message: 'Sugestão inicial enquanto ainda não há entregas concluídas suficientes.',
    },
  }));
  await page.route('**/api/online-orders/blocks', route => route.fulfill({ json: [] }));
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

async function navigateHorizontal(page: Page, label: string) {
  const subnav = page.locator('.cashier-subnav');
  await expect(subnav).toBeVisible();
  const tab = subnav.getByRole('button', { name: label, exact: true });
  await tab.click();
  await expect(tab).toHaveClass(/is-active/);
  await expect(page.locator('#mobile-caixa-sidebar')).not.toBeVisible();
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

      const subnav = page.locator('.cashier-subnav');
      await expect(subnav).toBeVisible();
      await expect(subnav.getByRole('button')).toHaveCount(7);
      await expect(subnav.getByRole('button', { name: 'Perfil', exact: true })).toHaveClass(/is-active/);
      await expect(page.getByRole('heading', { name: 'Perfil do cardápio', exact: true })).toBeVisible();
      await expect(page.getByText('Informações principais', { exact: true })).toBeVisible();
      const additional = page.locator('details').filter({ hasText: 'Informações adicionais' });
      await expect(additional).toBeVisible();
      await expect(additional).not.toHaveAttribute('open', '');

      await navigateHorizontal(page, 'Marca');
      await expect(page.getByRole('heading', { name: 'Marca', exact: true })).toBeVisible();
      await expectNoHorizontalOverflow(page);

      await navigateHorizontal(page, 'Pedidos online');
      await expect(page.getByRole('heading', { name: 'Pedidos online', exact: true })).toBeVisible();
      await expect(page.getByText('Horário do estabelecimento', { exact: true })).toBeVisible();
      await expectNoHorizontalOverflow(page);

      await navigateHorizontal(page, 'Clientes bloqueados');
      await expect(page.getByRole('heading', { name: 'Clientes bloqueados', exact: true })).toBeVisible();
      await expect(page.getByText('Histórico de bloqueios', { exact: true })).toBeVisible();
      await expectNoHorizontalOverflow(page);

      await navigateHorizontal(page, 'Entrega');
      await expect(page.getByRole('heading', { name: 'Entrega', exact: true })).toBeVisible();
      await expect(page.getByText('Taxa de entrega automática', { exact: true })).toBeVisible();
      await expect(page.getByText('Sugestão do KÔMA', { exact: true })).toBeVisible();
      const perKm = page.getByLabel('Valor por km da entrega');
      await expect(perKm).toBeVisible();
      await perKm.fill('0,50');
      await expect(perKm).toHaveValue('0,50');
      await expectNoHorizontalOverflow(page);

      await navigateHorizontal(page, 'Pagamentos');
      await expect(page.getByRole('heading', { name: 'Pagamentos', exact: true })).toBeVisible();
      await expect(page.getByText('Formas aceitas', { exact: true })).toBeVisible();
      await expectNoHorizontalOverflow(page);

      await navigateHorizontal(page, 'Divulgação');
      await expect(page.getByRole('heading', { name: 'Link e QR Code', exact: true })).toBeVisible();
      await expectNoHorizontalOverflow(page);

      const stickySaveBars = page.locator('[class*="sticky"]').filter({ hasText: /Salvar e publicar|Tudo salvo/i });
      await expect(stickySaveBars).toHaveCount(0);
      await expect(page.getByText('Tudo salvo', { exact: true })).toHaveCount(0);
    });
  }
}

test('cardápio online mantém abas verticais e horizontais no notebook', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 800 });
  await setup(page, 'dark');
  await page.goto('/?view=caixa');

  const sidebar = page.locator('.cashier-sidebar:visible');
  await expect(sidebar).toBeVisible();
  await sidebar.getByRole('button', { name: 'Cardápio online', exact: true }).click();
  await expect(page.locator('.cashier-topbar h2')).toHaveText(/Configurações do cardápio online/i);

  const subnav = page.locator('.cashier-subnav');
  await expect(subnav).toBeVisible();

  for (const label of ['Perfil', 'Marca', 'Pedidos online', 'Clientes bloqueados', 'Entrega', 'Pagamentos', 'Divulgação']) {
    await expect(sidebar.getByRole('button', { name: label, exact: true })).toBeVisible();
    await expect(subnav.getByRole('button', { name: label, exact: true })).toBeVisible();
  }

  await navigateHorizontal(page, 'Entrega');
  await expect(page.getByRole('heading', { name: 'Entrega', exact: true })).toBeVisible();
  await expectNoHorizontalOverflow(page);
});
