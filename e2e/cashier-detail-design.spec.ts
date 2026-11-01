import { expect, test } from '@playwright/test';
import { openOperationalScenario, showStage } from './fixtures/operational';

function luminance(css: string) {
  const rgb = (css.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
  return rgb.map(c => c / 255).map(c => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4)
    .reduce((sum, c, i) => sum + c * [.2126, .7152, .0722][i], 0);
}
for (const theme of ['dark', 'light']) {
  test(`detail separates reading, print and cancellation in ${theme}`, async ({ page }) => {
    await page.addInitScript(theme => localStorage.setItem('@koma:theme', theme), theme);
    const scenario = await openOperationalScenario(page);
    await showStage(page, 'Salão');
    await page.locator('.orders-card--salon').first().click();
    const dialog = page.locator('.orders-detail-modal');
    await expect(dialog.getByRole('heading', { name: 'Mesa 07', exact: true })).toBeVisible();
    await expect.poll(() => dialog.locator('.orders-detail-modal__number img').evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);
    const print = dialog.getByRole('button', { name: 'Reimprimir Total', exact: true });
    const cancel = dialog.getByRole('button', { name: 'Cancelar somente este pedido', exact: true });
    await expect(dialog.locator('.orders-detail-modal__items')).not.toBeVisible();
    await expect(print).toBeVisible();
    await expect(cancel).toBeVisible();
    const printStyle = await print.evaluate(el => ({ foreground: getComputedStyle(el).color, background: getComputedStyle(el).backgroundColor }));
    const foreground = luminance(printStyle.foreground), background = luminance(printStyle.background);
    expect((Math.max(foreground, background) + .05) / (Math.min(foreground, background) + .05)).toBeGreaterThanOrEqual(4.5);
    expect(await cancel.evaluate(el => getComputedStyle(el).backgroundColor)).not.toBe(printStyle.background);
    await page.screenshot({ path: test.info().outputPath(`detail-${theme}.png`), animations: 'disabled' });
    await print.click();
    await expect(dialog).toHaveCount(0);
    await page.locator('.orders-card--salon').first().click();
    await cancel.click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('dialog').getByRole('button', { name: 'Cancelar pedido', exact: true })).toBeDisabled();
    expect(scenario.actions.filter(action => /cancelar/.test(action.path))).toHaveLength(0);
  });
}
