import { expect, test, type Page, type WebSocketRoute } from '@playwright/test';
import { mockCashierBackend } from './fixtures/cashier';

async function setupWaiter(page: Page) {
  await mockCashierBackend(page);
  await page.routeWebSocket(/\/ws\//, (socket: WebSocketRoute) => {
    socket.onMessage(() => {});
  });
  await page.addInitScript(() => {
    localStorage.setItem('koma_waiter_token', 'waiter-cart-access-token');
    localStorage.setItem('koma_waiter_id', 'waiter-cart-access');
    localStorage.setItem('koma_waiter_name', 'Garçom do teste');
    localStorage.removeItem('koma_drafts_vFinal_v3');
  });
}

test('garçom continua no cardápio após personalizar e mantém acesso fixo ao pedido no mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setupWaiter(page);
  await page.goto('/?view=garcom');

  await page.locator('#mesa-card-10').click();
  await expect(page.locator('#search-products-input')).toBeVisible();

  await page.locator('#product-card-101').click();
  await expect(page.getByRole('button', { name: 'Adicionar ao Pedido', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Adicionar ao Pedido', exact: true }).click();

  // Adicionar um item configurado não deve interromper o fluxo de lançamento.
  await expect(page.locator('#search-products-input')).toBeVisible();

  // O pedido em andamento fica acessível sem voltar para outra aba ou rolar até o fim.
  const cartShortcut = page.locator('#open-draft-cart-btn');
  await expect(cartShortcut).toBeVisible();
  await expect(cartShortcut).toHaveCSS('position', 'fixed');
  await cartShortcut.click();

  await expect(page.getByRole('heading', { name: 'Revisar Pedido', exact: true })).toBeVisible();
  await expect(page.getByText('Risoto da casa', { exact: true })).toBeVisible();
});
