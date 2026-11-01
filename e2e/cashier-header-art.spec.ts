import { expect, test } from '@playwright/test';
import { openOperationalScenario } from './fixtures/operational';

function luminance(css: string) {
  const rgb = (css.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
  return rgb.map(c => c / 255).map(c => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4)
    .reduce((sum, c, i) => sum + c * [.2126, .7152, .0722][i], 0);
}

for (const theme of ['dark', 'light']) {
  test(`cashier header keeps real actions and readable surfaces in ${theme}`, async ({ page }) => {
    await page.addInitScript(theme => localStorage.setItem('@koma:theme', theme), theme);
    const scenario = await openOperationalScenario(page);
    const art = page.locator('.cashier-topbar__art');
    await expect.poll(() => art.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);
    await expect(art).toHaveAttribute('alt', '');
    const card = page.locator('.orders-card--salon').first();
    await expect(card.locator('.orders-card__state')).toHaveCount(0);
    await expect(card.locator('.orders-card__identity-chips')).toHaveCount(0);
    expect(await card.locator('.orders-card__identity-subtitle').evaluate(el => getComputedStyle(el).fontFamily)).toContain('Inter');
    expect(await page.locator('.cashier-topbar__identity h2').evaluate(el => getComputedStyle(el).fontFamily)).toContain('Space Grotesk');
    for (const selector of ['.orders-card__identity-title', '.orders-card__identity-subtitle', '.orders-card__price']) {
      const colors = await card.locator(selector).evaluate(el => ({
        foreground: getComputedStyle(el).color,
        background: getComputedStyle(el.closest('.orders-card')!).backgroundColor,
      }));
      const fg = luminance(colors.foreground), bg = luminance(colors.background);
      expect((Math.max(fg, bg) + .05) / (Math.min(fg, bg) + .05)).toBeGreaterThanOrEqual(4.5);
    }
    if (theme === 'dark') {
      const background = await page.locator('.cashier-main').evaluate(el => getComputedStyle(el).backgroundColor);
      expect(luminance(background)).toBeGreaterThan(.01);
    } else {
      const background = await card.evaluate(el => getComputedStyle(el).backgroundColor);
      expect(luminance(background)).toBeLessThan(.94);
    }
    await expect(page.locator('#btn-caixa-resumo')).toHaveCount(0);
    expect(scenario.actions).toHaveLength(0);
    for (const width of [320, 390, 768, 1366]) {
      await page.setViewportSize({ width, height: 844 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      expect(await page.locator('.cashier-topbar').evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    }
    await page.screenshot({ path: test.info().outputPath(`header-${theme}.png`) });
  });
}
