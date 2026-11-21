import { expect, test, type Page } from '@playwright/test';

const apiOrigin = 'http://127.0.0.1:8000';
const longName = 'Restaurante de Comida Regional e Lanches Artesanais da Vila do Sol';

async function mockStore(page: Page, socials: unknown, name = longName) {
  await page.routeWebSocket('**/ws/**', () => {});
  await page.route(`${apiOrigin}/**`, async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/cardapio-digital/public') {
      return route.fulfill({ json: {
        restaurante: {
          id: 99224, nome: name, slug: 'qa-b3-social-compact',
          aceitando_pedidos: true, status_override: 'Forçado Aberto',
          delivery_ativo: false, formas_pagamento_aceitas: ['Dinheiro'],
          socials,
        },
        categorias: [{ id: 1, nome: 'Salgados' }],
        produtos: [{ id: 901, nome: 'Pastel especial', preco: 14, categoria_id: 1, grupos_modificadores: [] }],
      } });
    }
    if (path === '/api/cardapio-digital/populares') {
      return route.fulfill({ json: { produtos: [] } });
    }
    return route.fulfill({ json: {} });
  });
}

test('B3: redes cadastradas são ícones tocáveis junto da busca, compartilhar está no topo', async ({ page }) => {
  await mockStore(page, { whatsapp: '(88) 99911-2233', instagram: '@loja_b3' });
  await page.goto('/c/qa-b3-social-compact');

  const whatsApp = page.locator('#btn-whatsapp-mobile');
  const instagram = page.locator('#btn-instagram-mobile');
  const share = page.locator('#btn-share-mobile');
  const search = page.getByRole('searchbox', { name: 'Campo de busca de produtos' });

  for (const width of [320, 360, 390, 430]) {
    await page.setViewportSize({ width, height: 760 });
    await expect(whatsApp).toBeVisible();
    await expect(instagram).toBeVisible();
    await expect(share).toBeVisible();
    await expect(search).toBeVisible();
    await expect(page.locator('#mobile-nav-cart')).toBeVisible();
    await expect(page.locator('#mobile-nav-account')).toBeVisible();

    for (const control of [whatsApp, instagram, share]) {
      const bounds = await control.boundingBox();
      expect(bounds).not.toBeNull();
      expect(bounds!.width).toBeGreaterThanOrEqual(40);
      expect(bounds!.height).toBeGreaterThanOrEqual(40);
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width + 1);
    }
    expect(await whatsApp.evaluate(element => Boolean(element.closest('.km-store-socials')))).toBe(true);
    expect(await share.evaluate(element => Boolean(element.closest('.km-hero-topbar')))).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }

  await expect(whatsApp).toHaveAttribute('href', 'https://wa.me/5588999112233');
  await expect(instagram).toHaveAttribute('href', 'https://instagram.com/loja_b3');
  await expect(whatsApp).toHaveAttribute('aria-label', 'Falar no WhatsApp');
  await expect(instagram).toHaveAttribute('aria-label', 'Instagram do restaurante');
  await expect(share).toHaveAttribute('aria-label', 'Compartilhar cardápio');

  await share.focus();
  await expect(share).toBeFocused();
  expect(await share.evaluate(el => getComputedStyle(el).outlineStyle)).not.toBe('none');
  await search.fill('Pastel');
  await expect(search).toHaveValue('Pastel');
  await page.locator('#header-brand-info-trigger').click();
  await expect(page.getByText(longName, { exact: true }).first()).toBeVisible();

  await page.setViewportSize({ width: 1366, height: 768 });
  await expect(whatsApp).toBeHidden();
  await expect(instagram).toBeHidden();
  await expect(share).toBeHidden();
  await expect(page.locator('#btn-whatsapp-header')).toBeVisible();
  await expect(page.locator('#btn-instagram-header')).toBeVisible();
  await expect(page.locator('#btn-share-header')).toBeVisible();
});

test('B3: loja sem redes não reserva lacunas nem exige WhatsApp para consultar produtos', async ({ page }) => {
  await mockStore(page, {}, 'Loja sem redes');
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto('/c/qa-b3-social-compact');

  await expect(page.locator('.km-store-socials')).toHaveCount(0);
  await expect(page.locator('#btn-whatsapp-mobile, #btn-instagram-mobile')).toHaveCount(0);
  await expect(page.locator('#btn-share-mobile')).toBeVisible();
  await expect(page.getByRole('searchbox', { name: 'Campo de busca de produtos' })).toBeVisible();
  await expect(page.getByText('Pastel especial').first()).toBeVisible();
  const [search, row] = await Promise.all([
    page.locator('.km-search-bar').boundingBox(),
    page.locator('.km-container').boundingBox(),
  ]);
  expect(search).not.toBeNull();
  expect(row).not.toBeNull();
  expect(search!.width).toBeGreaterThan(240);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('B3: compartilhar usa API nativa e mantém fallback de cópia', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: async () => { document.documentElement.dataset.nativeShared = 'yes'; },
    });
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async (value: string) => { document.documentElement.dataset.copiedUrl = value; } },
    });
  });
  await mockStore(page, {});
  await page.setViewportSize({ width: 390, height: 720 });
  await page.goto('/c/qa-b3-social-compact');
  await page.locator('#btn-share-mobile').click();
  await expect(page.locator('html')).toHaveAttribute('data-native-shared', 'yes');
  await expect(page.locator('html')).not.toHaveAttribute('data-copied-url', /.+/);

  await page.evaluate(() => {
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: async () => { throw new Error('native share failed'); },
    });
  });
  await page.locator('#btn-share-mobile').click();
  await expect(page.locator('html')).toHaveAttribute('data-copied-url', /qa-b3-social-compact/);
  await expect(page.getByRole('status', { name: '' }).filter({ hasText: 'Link do cardápio copiado!' })).toBeVisible();
});
