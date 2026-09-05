import { expect, test } from '@playwright/test';

import { mockCashierBackend, seedCashierSession } from './fixtures/cashier';

test('desktop baixo prioriza área operacional sem remover contexto', async ({ page }) => {
  const viewport = page.viewportSize();
  test.skip(
    !viewport || viewport.width < 1024 || viewport.height > 820,
    'Regra específica para desktops com pouca altura útil.',
  );

  await mockCashierBackend(page);
  await seedCashierSession(page);
  await page.goto('/?view=caixa');

  const ordersHero = page.locator('.orders-hero').first();
  await expect(ordersHero).toBeVisible();
  await expect(ordersHero.locator('.orders-eyebrow')).toBeHidden();
  await expect(ordersHero.locator('.orders-hero__copy > p:last-child')).toBeHidden();

  const ordersHeroHeight = await ordersHero.evaluate(element => element.getBoundingClientRect().height);
  expect(ordersHeroHeight).toBeLessThanOrEqual(50);

  const desktopSidebar = page.locator('.cashier-sidebar:visible');
  await expect(desktopSidebar.locator('.cashier-display-controls')).toBeHidden();
  await expect(desktopSidebar.getByRole('button', { name: 'Alternar tema' })).toBeVisible();
  await expect(desktopSidebar.locator('.cashier-operator')).toBeVisible();

  const board = page.locator('.orders-board');
  await expect(board).toBeVisible();
  const boardBox = await board.boundingBox();
  expect(boardBox).not.toBeNull();
  expect(boardBox!.y).toBeLessThan(260);

  await page.locator('.cashier-subnav').getByRole('button', { name: 'Novo pedido', exact: true }).click();

  const pdvHero = page.locator('.orders-hero').first();
  await expect(pdvHero).toBeVisible();
  await expect(pdvHero.getByRole('heading', { name: 'Novo pedido', exact: true })).toBeVisible();
  await expect(pdvHero.locator('.orders-eyebrow')).toBeHidden();
  await expect(pdvHero.locator('.orders-hero__copy > p:last-child')).toBeHidden();

  const pdvHeroHeight = await pdvHero.evaluate(element => element.getBoundingClientRect().height);
  expect(pdvHeroHeight).toBeLessThanOrEqual(50);

  const productSearch = page.getByPlaceholder('Buscar item, descrição ou código');
  await expect(productSearch).toBeVisible();
  const searchBox = await productSearch.boundingBox();
  expect(searchBox).not.toBeNull();
  expect(searchBox!.y).toBeLessThan(240);
});
