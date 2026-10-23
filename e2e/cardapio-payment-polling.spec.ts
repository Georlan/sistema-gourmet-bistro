import { expect, test } from '@playwright/test';

for (const variant of ['editorial', 'artistic-total'] as const) {
test.describe(variant, () => {
test('checkout reconciles approval after hidden pause without resubmitting the order', async ({ page }) => {
  let statusReads = 0;
  let submissions = 0;
  let approved = false;
  await page.addInitScript(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => Boolean((window as any).__testHidden) });
  });
  await page.route('http://127.0.0.1:8000/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/cardapio-digital/public') {
      await route.fulfill({ json: {
        restaurante: { id: 901, nome: 'Fixture local', status_override: 'Forçado Aberto', aceitando_pedidos: true,
          delivery_ativo: true, retirada_ativa: true, pagamento_online_ativo: true, formas_pagamento_aceitas: ['Pix'] },
        categorias: [{ id: 1, nome: 'Lanches' }],
        produtos: [{ id: 101, nome: 'Lanche local', preco: 10, categoria_id: 1, imagem_url: '', grupos_modificadores: [] }],
      } });
    } else if (path === '/cardapio/pedidos' && route.request().method() === 'POST') {
      submissions++;
      await route.fulfill({ json: { comanda_id: 'fixture-payment', numero_pedido: 101, total: 10,
        pagamento: { cobranca_online: true, status: 'pending', qr_code: 'fixture-pix', metodo: 'pix' } } });
    } else if (path === '/cardapio/pedidos/fixture-payment/status') {
      statusReads++;
      await route.fulfill({ json: { pagamento: { status: approved ? 'approved' : 'pending' } } });
    } else {
      await route.fulfill({ json: path.includes('populares') ? { produtos: [] } : {} });
    }
  });
  await page.clock.install();
  await page.goto(`/cardapio?restaurante_id=901&vitrine=${variant}`);
  await page.locator('#btn-fast-add-101').click();
  if (!await page.locator('#cart-drawer-container').isVisible()) {
    await page.locator('#mobile-nav-cart:visible, #btn-cart-header:visible').first().click();
  }
  const cart = page.locator('#cart-drawer-container');
  await cart.locator('#btn-confirm-order').click();
  await cart.getByRole('button', { name: /^Retirada/ }).click();
  await cart.locator('#btn-confirm-order').click();
  await cart.getByRole('button', { name: 'Pix', exact: true }).click();
  await cart.locator('#btn-confirm-order').click();
  await cart.locator('#input-guest-name').fill('Fixture local');
  await cart.locator('#input-guest-phone').fill('85999999999');
  await cart.locator('#input-customer-email').fill('fixture@example.test');
  await cart.locator('#btn-confirm-order').click();
  await page.locator('#btn-place-order-final').click();
  await expect(page.locator('#checkout-card')).toContainText('Aguardando pagamento');
  await expect.poll(() => statusReads).toBeGreaterThan(0);
  const visibleReads = statusReads;
  await page.clock.runFor(3_000);
  await expect.poll(() => statusReads).toBeGreaterThan(visibleReads);
  await page.evaluate(() => { (window as any).__testHidden = true; document.dispatchEvent(new Event('visibilitychange')); });
  const before = statusReads;
  await page.clock.runFor(60_000);
  expect(statusReads).toBe(before);
  approved = true; // Simulates an authoritative approval while the customer is away.
  await page.evaluate(() => { (window as any).__testHidden = false; document.dispatchEvent(new Event('visibilitychange')); });
  await expect(page.locator('#checkout-card')).toContainText('Pedido recebido');
  expect(submissions).toBe(1);
  const terminalReads = statusReads;
  await page.clock.runFor(30_000);
  expect(statusReads).toBe(terminalReads);
});

});
}
