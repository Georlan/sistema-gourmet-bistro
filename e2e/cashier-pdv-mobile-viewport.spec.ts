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

test('PDV phone uses one bounded scroll owner, compact footer and stable screen geometry', async ({ page }, info) => {
  for (const [width, height] of [[320, 620], [360, 640], [390, 740], [430, 800]]) {
    await page.setViewportSize({ width, height });
    await openNewOrder(page);

    const shell = page.locator('.cashier-shell--mobile-pdv');
    const dock = page.locator('#pdv-review-btn');
    const productScroll = page.locator('.cashier-pdv-product-scroll');
    const nav = page.locator('.cashier-mobile-bottom-bar');

    await expect(shell).toBeVisible();
    await expect(page.locator('.cashier-pdv-mobile-switch')).toHaveCount(0);
    await expect(dock).toBeInViewport();
    await expect(dock).toHaveCSS('position', 'static');
    await expect(productScroll).toHaveCSS('overflow-y', 'auto');

    // Document and chrome are not allowed to scroll when catalog products do.
    await productScroll.evaluate(el => { el.scrollTop = el.scrollHeight; });
    const previousCatalogScroll = await productScroll.evaluate(el => el.scrollTop);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
    const shellPosBefore = await shell.evaluate(el => el.getBoundingClientRect().top);
    const topbarBefore = await page.locator('.cashier-topbar').evaluate(el => el.getBoundingClientRect().top);
    expect(shellPosBefore).toBe(0);
    expect(topbarBefore).toBe(0);

    await dock.click(); // Even at 0 items the cart must remain reachable.
    const cart = page.locator('#pdv-order-panel');
    const footer = cart.locator('.cashier-pdv-cart__footer');
    const body = cart.locator('.cashier-pdv-cart__body');
    await expect(cart).toBeVisible();
    await expect(cart.getByText('Carrinho vazio')).toBeVisible();
    await expect(footer).toHaveCSS('position', 'static');
    await expect(body).toHaveCSS('overflow-y', 'auto');
    const footerY = await footer.evaluate(el => el.getBoundingClientRect().bottom);
    const navY = await nav.evaluate(el => el.getBoundingClientRect().top);
    expect(footerY).toBeLessThanOrEqual(navY + 1);

    await cart.getByRole('button', { name: 'Escolher itens' }).click();
    expect(await productScroll.evaluate(el => el.scrollTop)).toBe(previousCatalogScroll);
    const card = page.getByTestId('cashier-pdv-product-card').filter({ hasText: 'Risoto da casa' }).first();
    await card.getByRole('button', { name: 'Adicionar Risoto da casa rapidamente' }).click();
    await dock.click();
    await expect(footer).toContainText('R$ 42,00');

    // Fill enough real checkout fields to force only the order body to scroll.
    await cart.locator('details').filter({ hasText: 'Identificação do cliente' }).locator('summary').click();
    await cart.getByLabel('Nome', { exact: true }).fill('Maria');
    await cart.locator('details').filter({ hasText: 'Pagamento' }).locator('summary').click();
    await cart.getByRole('group', { name: 'Forma de pagamento' }).getByRole('button', { name: 'Pix' }).click();
    await body.evaluate(el => { el.scrollTop = el.scrollHeight; });

    const after = await page.evaluate(() => {
      const shell = document.querySelector('.cashier-shell--mobile-pdv')!;
      const top = document.querySelector('.cashier-topbar')!;
      const footer = document.querySelector('.cashier-pdv-cart__footer')!;
      const nav = document.querySelector('.cashier-mobile-bottom-bar')!;
      return {
        windowY: window.scrollY,
        shellY: shell.getBoundingClientRect().top,
        shellHeight: shell.getBoundingClientRect().height,
        headerY: top.getBoundingClientRect().top,
        footerEnd: footer.getBoundingClientRect().bottom,
        navStart: nav.getBoundingClientRect().top,
        xOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    });
    expect(after.windowY).toBe(0);
    expect(after.shellY).toBe(0);
    expect(after.headerY).toBe(0);
    expect(after.shellHeight).toBe(height);
    expect(after.footerEnd).toBeLessThanOrEqual(after.navStart + 1);
    expect(after.xOverflow).toBeLessThanOrEqual(1);
    await expect(footer.locator('#pdv-submit-btn')).toBeInViewport();

    if (process.env.KOMA_CAPTURE_UI) {
      await page.screenshot({ path: info.outputPath(`pdv-single-scroll-${width}x${height}.png`) });
    }

    await cart.getByRole('button', { name: 'Escolher itens' }).click();
    await expect(dock).toBeVisible();
    await dock.click();
    await expect(cart.getByLabel('Nome', { exact: true })).toHaveValue('Maria');
    await expect(cart.getByRole('button', { name: 'Pix' })).toHaveAttribute('aria-pressed', 'true');
  }
});

test('PDV on short viewport retains checkout and focused inputs inside scrollable order body', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 490 });
  await openNewOrder(page);
  await page.getByRole('button', { name: 'Adicionar Risoto da casa rapidamente' }).click();
  await page.locator('#pdv-review-btn').click();
  const body = page.locator('.cashier-pdv-cart__body');
  await expect(body).toHaveCSS('overflow-y', 'auto');
  const options = page.locator('.cashier-pdv-cart__modality-option');
  await options.filter({ hasText: 'Delivery' }).click();
  await expect(page.locator('#pdv-delivery-address-logradouro')).toBeVisible();

  const name = page.locator('#pdv-customer-name-input');
  await name.fill('Maria');
  await name.focus();
  await expect(name).toBeFocused();
  await expect(page.locator('#pdv-submit-btn')).toBeInViewport();
  const chrome = await page.locator('.cashier-topbar').evaluate(el => el.getBoundingClientRect().top);
  expect(chrome).toBe(0);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  const footer = page.locator('.cashier-pdv-cart__footer');
  await expect(footer).toContainText('R$ 42,00');
});
