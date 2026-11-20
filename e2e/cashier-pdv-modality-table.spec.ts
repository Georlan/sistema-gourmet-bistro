import { expect, test } from '@playwright/test';
import { mockCashierBackend, seedCashierSession } from './fixtures/cashier';

test('switching PDV from Consumo local to Retirada clears selected table and never leaks mesa_id', async ({ page }) => {
  await mockCashierBackend(page);
  await seedCashierSession(page);

  const saleBodies: Array<Record<string, unknown>> = [];
  await page.route('**/cardapio/modificadores/venda-direta', async route => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    saleBodies.push(body);
    await route.fulfill({
      status: 200,
      json: { id: `sale-${saleBodies.length}`, mesa_id: body.mesa_id, tipo: body.tipo, itens: [] },
    });
  });

  await page.goto('/?view=caixa');
  await expect(page.locator('.orders-board')).toBeVisible();

  const newOrder = () => page.locator('.cashier-subnav').getByRole('button', { name: 'Novo pedido', exact: true });
  const showCart = async () => {
    const cart = page.getByRole('button', { name: /^Carrinho \(/ });
    if (await cart.isVisible()) await cart.click();
    await expect(page.locator('#pdv-submit-btn')).toBeVisible();
  };

  await newOrder().click();
  await page.getByRole('button', { name: 'Adicionar Risoto da casa rapidamente', exact: true }).click();
  await showCart();

  // Select Consumo local + Mesa 10
  await page.locator('.cashier-pdv-cart__modality-option').filter({ hasText: 'Consumo local' }).click();
  await page.locator('#pdv-target-table').click();
  await page.locator('#pdv-table-picker').getByRole('button', { name: /^Mesa 10 / }).click();
  await expect(page.locator('#pdv-target-table')).toHaveAttribute('data-table-id', '10');

  // Switch to Retirada — table picker disappears, so table selection must be cleared.
  await page.locator('.cashier-pdv-cart__modality-option').filter({ hasText: 'Retirada' }).click();
  await expect(page.locator('#pdv-target-table')).toHaveCount(0);
  await expect(page.getByText('Retirada · Mesa 10')).toHaveCount(0);

  await page.locator('#pdv-submit-btn').click();
  await expect(page.getByText('Pedido confirmado e enviado à cozinha.', { exact: true })).toBeVisible();

  expect(saleBodies).toHaveLength(1);
  expect(saleBodies[0].tipo).toBe('Balcão');
  expect(saleBodies[0].mesa_id).toBeNull();
});

test('confirmed dine-in PDV sale clears mesa selection for the next order', async ({ page }) => {
  await mockCashierBackend(page);
  await seedCashierSession(page);

  const saleBodies: Array<Record<string, unknown>> = [];
  await page.route('**/cardapio/modificadores/venda-direta', async route => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    saleBodies.push(body);
    await route.fulfill({
      status: 200,
      json: { id: `sale-${saleBodies.length}`, mesa_id: body.mesa_id, tipo: body.tipo, itens: [] },
    });
  });

  await page.goto('/?view=caixa');
  await expect(page.locator('.orders-board')).toBeVisible();

  const newOrder = () => page.locator('.cashier-subnav').getByRole('button', { name: 'Novo pedido', exact: true });
  const showCart = async () => {
    const cart = page.getByRole('button', { name: /^Carrinho \(/ });
    if (await cart.isVisible()) await cart.click();
    await expect(page.locator('#pdv-submit-btn')).toBeVisible();
  };

  // First order: Consumo local on Mesa 10
  await newOrder().click();
  await page.getByRole('button', { name: 'Adicionar Risoto da casa rapidamente', exact: true }).click();
  await showCart();
  await page.locator('.cashier-pdv-cart__modality-option').filter({ hasText: 'Consumo local' }).click();
  await page.locator('#pdv-target-table').click();
  await page.locator('#pdv-table-picker').getByRole('button', { name: /^Mesa 10 / }).click();
  await page.locator('#pdv-submit-btn').click();
  await expect(page.getByText('Pedido confirmado e enviado à cozinha.', { exact: true })).toBeVisible();
  expect(saleBodies[0].mesa_id).toBe(10);

  // Return to PDV for the next order: switching back to Consumo local must start with no stale table selected.
  await newOrder().click();
  await page.getByRole('button', { name: 'Adicionar Risoto da casa rapidamente', exact: true }).click();
  await showCart();
  await page.locator('.cashier-pdv-cart__modality-option').filter({ hasText: 'Consumo local' }).click();
  await expect(page.locator('#pdv-target-table')).toHaveAttribute('data-table-id', '0');

  // Keyboard shortcut F2 (Retirada) from Consumo local + Mesa 10 must also clear table selection.
  await page.locator('#pdv-target-table').click();
  await page.locator('#pdv-table-picker').getByRole('button', { name: /^Mesa 10 / }).click();
  await expect(page.locator('#pdv-target-table')).toHaveAttribute('data-table-id', '10');
  await page.keyboard.press('F2');
  await expect(page.locator('#pdv-target-table')).toHaveCount(0);
  await page.locator('#pdv-submit-btn').click();
  await expect(page.getByText('Pedido confirmado e enviado à cozinha.', { exact: true })).toBeVisible();
  expect(saleBodies).toHaveLength(2);
  expect(saleBodies[1].tipo).toBe('Balcão');
  expect(saleBodies[1].mesa_id).toBeNull();
});
