import { expect, test } from '@playwright/test';
import { mockCashierBackend, seedCashierSession } from './fixtures/cashier';
test('indicators are removed across cashier workspaces while navigation remains available', async ({ page }) => {
  await mockCashierBackend(page); await seedCashierSession(page);
  await page.goto('/?view=caixa');
  await expect(page.locator('.orders-board')).toBeVisible();
  await expect(page.locator('#btn-caixa-resumo,.operational-summary')).toHaveCount(0);
  for (const label of ['Novo pedido', 'Salão', 'Cozinha', 'Retiradas', 'Entregas', 'Pedidos']) {
    const button = page.getByRole('navigation', { name: 'Telas desta área' }).getByRole('button', { name: label, exact: true });
    await button.click(); await expect(button).toHaveAttribute('aria-current', 'page');
    await expect(page.locator('#btn-caixa-resumo,.operational-summary')).toHaveCount(0);
  }
});
