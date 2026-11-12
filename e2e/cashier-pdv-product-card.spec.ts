import { expect, test } from '@playwright/test';
import { mockCashierBackend, seedCashierSession } from './fixtures/cashier';

async function openNewOrder(page: Parameters<typeof mockCashierBackend>[0]) {
  await mockCashierBackend(page);
  await seedCashierSession(page);
  await page.addInitScript(() => {
    sessionStorage.setItem('koma_active_tab', 'operacao');
    sessionStorage.setItem('koma_active_subtab', 'balcao');
  });
  await page.goto('/?view=caixa');
  await expect(page.getByPlaceholder('Buscar item, descrição ou código')).toBeVisible();
}

test('PDV: quick-add and personalize are independent on desktop and mobile', async ({ page }) => {
  await openNewOrder(page);

  const card = page.getByTestId('cashier-pdv-product-card').filter({ hasText: 'Risoto da casa' }).first();
  await expect(card).toBeVisible();

  const add = card.getByRole('button', { name: 'Adicionar Risoto da casa rapidamente' });
  const customize = card.getByRole('button', { name: 'Personalizar Risoto da casa' });
  await expect(add).toBeVisible();
  await expect(customize).toBeVisible();
  await expect(card.locator('.cashier-pdv-product-card__price')).toContainText('42,00');

  await add.click();
  await expect(card.locator('.cashier-pdv-product-card__quantity')).toHaveText('1');
  await expect(page.getByText('Personalizar item', { exact: true })).toHaveCount(0);

  if ((page.viewportSize()?.width ?? 1366) < 1280) {
    await page.getByRole('button', { name: /Carrinho \(1\)/ }).click();
  }
  await expect(page.locator('.cashier-pdv-cart__line').first()).toContainText('Risoto da casa');
  await expect(page.locator('.cashier-pdv-cart__total')).toContainText('42,00');

  if ((page.viewportSize()?.width ?? 1366) < 1280) {
    await page.getByRole('button', { name: 'Escolher itens' }).click();
  }
  await customize.click();
  await expect(page.getByText('Personalizar item', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Fechar personalização' }).click();
});

test('PDV: readable product action and visible focus without horizontal overflow', async ({ page }) => {
  await openNewOrder(page);
  const card = page.getByTestId('cashier-pdv-product-card').first();
  const fontSize = await card.locator('.cashier-pdv-product-card__name').evaluate((node) => parseFloat(getComputedStyle(node).fontSize));
  expect(fontSize).toBeGreaterThanOrEqual(13);

  await expect(page.locator('body')).toHaveJSProperty('scrollWidth', await page.locator('body').evaluate(el => el.clientWidth));

  const focusButton = card.getByRole('button', { name: /Personalizar/ });
  await page.keyboard.press('Tab');
  await focusButton.focus();
  await expect(focusButton).toBeFocused();
  const outline = await focusButton.evaluate(el => getComputedStyle(el).outlineStyle);
  expect(outline).not.toBe('none');
});
