import { expect, test } from '@playwright/test';

test('B3: adição rápida confirma pela quantidade e live region, sem toast sobre os produtos', async ({ page }) => {
  await page.routeWebSocket('**/ws/**', () => {});
  await page.route('http://127.0.0.1:8000/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/cardapio-digital/public') {
      return route.fulfill({ json: {
        restaurante: {
          id: 99501, nome: 'Loja Feedback B3', slug: 'qa-b3-feedback',
          aceitando_pedidos: true, status_override: 'Forçado Aberto',
          delivery_ativo: false, formas_pagamento_aceitas: ['Dinheiro'],
        },
        categorias: [{ id: 1, nome: 'Lanches' }],
        produtos: [{ id: 901, nome: 'Pastel de queijo', preco: 12, categoria_id: 1, grupos_modificadores: [] }],
      } });
    }
    if (path === '/api/cardapio-digital/populares') return route.fulfill({ json: { produtos: [] } });
    return route.fulfill({ json: {} });
  });

  await page.setViewportSize({ width: 390, height: 760 });
  await page.goto('/c/qa-b3-feedback');
  const add = page.locator('#btn-hero-fast-add-901');
  await expect(add).toBeVisible();
  await add.click();
  await expect(page.locator('#btn-cart-header')).toHaveAttribute('aria-label', 'Sua sacola, 1 item');
  await expect(page.locator('#app-root-container > span[aria-live="polite"]')).toContainText('1 unidade incluída: Pastel de queijo');
  await expect(page.locator('#app-root-container > div[role="status"]')).toHaveCount(0);

  await page.locator('#koma-art-hero-showcase').getByRole('button', { name: 'Aumentar quantidade' }).click();
  await expect(page.locator('#btn-cart-header')).toHaveAttribute('aria-label', 'Sua sacola, 2 itens');
  await expect(page.locator('#app-root-container > div[role="status"]')).toHaveCount(0);
  await page.locator('#mobile-nav-cart').click();
  await expect(page.locator('#cart-drawer-container')).toBeVisible();
  await expect(page.locator('#cart-drawer-container')).toContainText('Pastel de queijo');
  await page.keyboard.press('Escape');
  await expect(page.locator('#cart-drawer-container')).toBeHidden();
});
