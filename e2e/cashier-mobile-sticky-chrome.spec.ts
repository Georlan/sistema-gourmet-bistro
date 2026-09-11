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
  await expect(page.locator('.cashier-subnav')).toBeVisible();
}

for (const theme of ['dark', 'light'] as const) {
  for (const viewport of [
    { width: 360, height: 800 },
    { width: 412, height: 915 },
  ] as const) {
    test(`topbar e subnav permanecem fixos no scroll em ${viewport.width}px no tema ${theme}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await openCashier(page, theme);

      await page.locator('.cashier-content').evaluate((content) => {
        const spacer = document.createElement('div');
        spacer.setAttribute('data-testid', 'sticky-scroll-spacer');
        spacer.style.height = '1600px';
        spacer.style.pointerEvents = 'none';
        content.appendChild(spacer);
      });

      const topbar = page.locator('.cashier-topbar');
      const subnav = page.locator('.cashier-subnav');

      const initial = await page.evaluate(() => {
        const topbar = document.querySelector('.cashier-topbar') as HTMLElement;
        const subnav = document.querySelector('.cashier-subnav') as HTMLElement;
        return {
          topbarPosition: getComputedStyle(topbar).position,
          subnavPosition: getComputedStyle(subnav).position,
          topbarHeight: topbar.getBoundingClientRect().height,
        };
      });

      expect(initial.topbarPosition).toBe('sticky');
      expect(initial.subnavPosition).toBe('sticky');
      expect(initial.topbarHeight).toBeGreaterThanOrEqual(56);

      await page.evaluate(() => window.scrollTo({ top: 700, behavior: 'instant' }));
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(300);

      const geometry = await page.evaluate(() => {
        const topbar = document.querySelector('.cashier-topbar') as HTMLElement;
        const subnav = document.querySelector('.cashier-subnav') as HTMLElement;
        const topbarBox = topbar.getBoundingClientRect();
        const subnavBox = subnav.getBoundingClientRect();
        return {
          topbarTop: topbarBox.top,
          topbarBottom: topbarBox.bottom,
          subnavTop: subnavBox.top,
          subnavBottom: subnavBox.bottom,
        };
      });

      expect(Math.abs(geometry.topbarTop)).toBeLessThanOrEqual(1);
      expect(Math.abs(geometry.subnavTop - geometry.topbarBottom)).toBeLessThanOrEqual(1);
      expect(geometry.subnavBottom).toBeLessThan(viewport.height / 3);

      await expect(page.getByRole('button', { name: 'Abrir menu principal' })).toBeVisible();
      await expect(page.locator('.cashier-subnav__button').first()).toBeVisible();
    });
  }
}
