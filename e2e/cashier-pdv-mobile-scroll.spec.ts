import { expect, type Locator, type Page, test } from '@playwright/test';

import { mockCashierBackend, seedCashierSession } from './fixtures/cashier';

async function swipeUpInside(page: Page, target: Locator) {
  const client = await page.context().newCDPSession(page);
  const viewport = page.viewportSize();
  if (!viewport) throw new Error('Viewport indisponível para o gesto de toque.');

  const box = await target.boundingBox();
  if (!box) throw new Error('Área de produtos do PDV não está visível.');

  const x = Math.round(Math.min(viewport.width - 24, Math.max(24, box.x + box.width / 2)));
  const startY = Math.round(Math.min(viewport.height - 80, Math.max(160, box.y + Math.min(box.height * 0.65, 420))));
  const endY = Math.round(Math.max(100, startY - 360));

  await client.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x, y: startY }],
  });

  for (let step = 1; step <= 6; step += 1) {
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x, y: startY + ((endY - startY) * step) / 6 }],
    });
  }

  await client.send('Input.dispatchTouchEvent', {
    type: 'touchEnd',
    touchPoints: [],
  });
}

test('Novo pedido usa o documento como scroll vertical no mobile', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await mockCashierBackend(page);
  await seedCashierSession(page);
  await page.addInitScript(() => {
    sessionStorage.setItem('koma_active_tab', 'operacao');
    sessionStorage.setItem('koma_active_subtab', 'balcao');
  });

  await page.goto('/?view=caixa');

  const productScroll = page.locator('.cashier-pdv-product-scroll');
  await expect(productScroll).toBeVisible();

  await expect.poll(() => productScroll.evaluate(element => getComputedStyle(element).overflowY)).toBe('visible');

  await productScroll.evaluate((element) => {
    const spacer = document.createElement('div');
    spacer.setAttribute('data-testid', 'pdv-mobile-scroll-spacer');
    spacer.style.height = '1500px';
    spacer.style.pointerEvents = 'none';
    element.appendChild(spacer);
  });

  const viewport = page.viewportSize();
  if (!viewport) throw new Error('Viewport indisponível.');
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollHeight)).toBeGreaterThan(viewport.height);

  const scrollBefore = await page.evaluate(() => window.scrollY);
  await swipeUpInside(page, productScroll);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(scrollBefore);

  await expect(page.locator('.cashier-topbar')).toBeVisible();
  await expect(page.locator('.cashier-subnav')).toBeVisible();
});
