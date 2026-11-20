import { expect, Page, test } from '@playwright/test';

import { mockCashierBackend, seedCashierSession } from './fixtures/cashier';

async function openCashier(page: Page, theme: 'dark' | 'light') {
  await mockCashierBackend(page);
  await seedCashierSession(page);
  await page.addInitScript((nextTheme) => {
    localStorage.setItem('@koma:theme', nextTheme);
  }, theme);
  await page.goto('/?view=caixa');
  await expect(page.locator('html')).toHaveAttribute('data-koma-theme', theme);
  await expect(page.locator('.cashier-topbar')).toBeVisible();
  await expect(page.locator('.cashier-subnav')).toBeHidden();
  await expect(page.locator('.orders-toolbar')).toBeVisible();
}

for (const theme of ['dark', 'light'] as const) {
  for (const viewport of [
    { width: 360, height: 800 },
    { width: 412, height: 915 },
  ] as const) {
    test(`topbar compacto e controles permanecem fixos no scroll em ${viewport.width}px no tema ${theme}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await openCashier(page, theme);

      const scroller = page.locator('.orders-workspace__scroll-region');
      await scroller.evaluate((content) => {
        const spacer = document.createElement('div');
        spacer.setAttribute('data-testid', 'sticky-scroll-spacer');
        spacer.style.height = '1600px';
        spacer.style.flexShrink = '0';
        spacer.style.pointerEvents = 'none';
        content.appendChild(spacer);
      });

      const topbar = page.locator('.cashier-topbar');
      const toolbar = page.locator('.orders-toolbar');
      const toolbarBefore = (await toolbar.boundingBox())!;
      const bottomBar = page.getByRole('navigation', { name: 'Navegação móvel principal' });
      const bottomBefore = await bottomBar.boundingBox();

      const initial = await page.evaluate(() => {
        const topbar = document.querySelector('.cashier-topbar') as HTMLElement;
        return {
          topbarPosition: getComputedStyle(topbar).position,
          topbarHeight: topbar.getBoundingClientRect().height,
        };
      });

      expect(initial.topbarPosition).toBe('sticky');
      expect(initial.topbarHeight).toBe(48);

      await scroller.evaluate((content) => content.scrollTo({ top: 700, behavior: 'instant' }));
      await expect.poll(() => scroller.evaluate((content) => content.scrollTop)).toBeGreaterThan(300);
      await expect(page.locator('.cashier-content')).toHaveJSProperty('scrollTop', 0);

      const geometry = await page.evaluate(() => {
        const topbar = document.querySelector('.cashier-topbar') as HTMLElement;
        const topbarBox = topbar.getBoundingClientRect();
        return {
          topbarTop: topbarBox.top,
          topbarBottom: topbarBox.bottom,
        };
      });

      expect(Math.abs(geometry.topbarTop)).toBeLessThanOrEqual(1);
      const toolbarAfter = (await toolbar.boundingBox())!;
      expect(Math.abs(toolbarAfter.y - toolbarBefore.y)).toBeLessThanOrEqual(1);
      expect(toolbarAfter.y + toolbarAfter.height).toBeLessThan(viewport.height / 3);
      const bottomAfter = await bottomBar.boundingBox();
      expect(bottomBefore).not.toBeNull();
      expect(bottomAfter).not.toBeNull();
      expect(Math.abs(bottomAfter!.y - bottomBefore!.y)).toBeLessThanOrEqual(1);

      await expect(page.getByRole('button', { name: 'Abrir menu principal' })).toBeVisible();
      await expect(bottomBar.getByRole('button', { name: 'Pedidos', exact: true })).toBeVisible();
      await expect(toolbar.getByRole('searchbox', { name: 'Buscar pedidos' })).toBeVisible();
    });
  }
}
