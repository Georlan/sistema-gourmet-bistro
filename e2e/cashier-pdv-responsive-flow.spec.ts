import { expect, test } from '@playwright/test';
import { mockCashierBackend, seedCashierSession } from './fixtures/cashier';

test('item simples entra no pedido ao tocar no cartão sem nova consulta ao catálogo', async ({ page }) => {
  await mockCashierBackend(page);
  await seedCashierSession(page);
  await page.addInitScript(() => {
    sessionStorage.setItem('koma_active_tab', 'operacao');
    sessionStorage.setItem('koma_active_subtab', 'balcao');
  });
  let catalogRequests = 0;
  page.on('request', request => {
    if (new URL(request.url()).pathname === '/produtos/catalogo') catalogRequests++;
  });
  await page.goto('/?view=caixa');
  const card = page.locator('.cashier-pdv-product-scroll [role="button"]').filter({ hasText: 'Risoto da casa' });
  await expect(card).toBeVisible();
  const initialRequests = catalogRequests;
  await card.click();
  const cart = page.getByRole('button', { name: 'Carrinho (1)', exact: true });
  if (await cart.isVisible()) await cart.click();
  await expect(page.getByRole('button', { name: 'Remover Risoto da casa', exact: true })).toBeVisible();
  await expect(page.locator('#pdv-submit-btn')).toBeVisible();
  expect(catalogRequests).toBe(initialRequests);
});
