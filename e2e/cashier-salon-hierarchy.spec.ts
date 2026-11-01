import { expect, test } from '@playwright/test';
import { openOperationalScenario } from './fixtures/operational';

for (const theme of ['dark', 'light']) {
  test(`salon identity keeps name, slice amount and launch printing readable in ${theme}`, async ({ page }) => {
    await page.addInitScript(theme => localStorage.setItem('@koma:theme', theme), theme);
    const scenario = await openOperationalScenario(page, {
      canonicalIdentity: true,
      tableName: 'Varanda externa perto do jardim',
    });
    const card = page.locator('.orders-card--salon').first();
    await expect(page.locator('.orders-column--salon h3')).toHaveText('Salão');
    await expect(page.locator('.orders-column--digital h3')).toHaveText('Balcão e online');
    await expect(page.locator('.orders-column--closing h3')).toHaveText('Prontos e recebimentos');
    await expect(page.locator('.orders-column__number')).toHaveCount(0);
    await expect(page.locator('.orders-column--salon .orders-column__count')).toHaveText('1');
    for (const header of await page.locator('.orders-column__header').all()) {
      if (await header.isVisible()) expect(await header.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    }
    await expect(card).toContainText('Pedido 24-A');
    await expect(card).toContainText('Varanda externa perto do jardim');
    await expect(card.locator('.orders-card__number strong')).toHaveText('07');
    const numberContrast = await card.locator('.orders-card__number strong').evaluate(el => {
      const light = (css: string) => (css.match(/[\d.]+/g) ?? []).slice(0,3).map(Number)
        .map(v => v/255).map(v => v <= .04045 ? v/12.92 : ((v+.055)/1.055)**2.4)
        .reduce((sum,v,i) => sum+v*[.2126,.7152,.0722][i],0);
      const fg=light(getComputedStyle(el).color), bg=light(getComputedStyle(el.parentElement!).backgroundColor);
      return (Math.max(fg,bg)+.05)/(Math.min(fg,bg)+.05);
    });
    expect(numberContrast).toBeGreaterThanOrEqual(4.5);
    await expect(card.locator('.orders-card__number-label')).toHaveCount(0);
    await expect(card.locator('.orders-card__number svg')).toHaveCount(0);
    await expect(card.locator('.orders-card__number .orders-card__table-label')).toHaveText('Mesa');
    await expect(card.locator('.orders-card__price')).toHaveText(/112,00/);
    await expect(card.locator('.orders-card__age')).toBeVisible();
    for (const element of await card.locator('.orders-card__identity, .orders-card__identity-title, .orders-card__identity-subtitle, .orders-card__price').all()) {
      expect(await element.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    }
    const print = card.getByRole('button', { name: 'Reimprimir Pedido 24-A', exact: true });
    const bounds = await print.boundingBox();
    expect(bounds?.width).toBeGreaterThanOrEqual(44);
    expect(bounds?.height).toBeGreaterThanOrEqual(44);
    await print.focus();
    expect(await print.evaluate(el => getComputedStyle(el).outlineStyle)).toBe('solid');
    await page.keyboard.press('Enter');
    await expect.poll(() => scenario.actions.filter(action => action.path.includes('/lancamentos/') && action.path.includes('/reimprimir')).length).toBe(1);
    await expect(page.locator('.orders-detail-modal')).toHaveCount(0);
    await page.screenshot({ path: test.info().outputPath(`salao-${theme}.png`) });
  });
}
