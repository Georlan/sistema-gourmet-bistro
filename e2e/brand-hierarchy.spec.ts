import {openOperationalScenario} from './fixtures/operational';
import {expect, test, type Locator} from '@playwright/test';
async function ratio(locator: Locator) {
  return locator.evaluate(element => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext('2d')!;
    const color = (value: string) => {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = value;
      ctx.fillRect(0, 0, 1, 1);
      return Array.from(ctx.getImageData(0, 0, 1, 1).data);
    };
    const blend = (top: number[], bottom: number[], alpha: number) => top.map((c, i) => c * alpha + bottom[i] * (1 - alpha));
    let bg = [255, 255, 255];
    const chain: Element[] = [];
    for (let node: Element | null = element; node; node = node.parentElement) chain.unshift(node);
    for (const node of chain) {
      const value = getComputedStyle(node).backgroundColor;
      if (value === 'rgba(0, 0, 0, 0)' || value === 'transparent') continue;
      const rgba = color(value);
      bg = blend(rgba.slice(0, 3), bg, rgba[3] / 255);
    }
    const luminance = (rgb: number[]) => rgb.map(c => {
      const v = c / 255;
      return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4;
    }).reduce((sum, c, i) => sum + c * [.2126, .7152, .0722][i], 0);
    const fg = luminance(color(getComputedStyle(element).color).slice(0, 3));
    const background = luminance(bg);
    return (Math.max(fg, background) + .05) / (Math.min(fg, background) + .05);
  });
}

for (const theme of ['dark','light']) for (const scale of [1,1.4]) {
  test(`operational color hierarchy remains readable ${theme} ${scale}`,async ({page})=>{
    await page.goto(`/e2e/fixtures/brand-hierarchy.html?theme=${theme}&scale=${scale}`);
    for (const selector of ['.orders-card__identity-title','.orders-card__identity-subtitle','.orders-card__number strong','.orders-card__price','.orders-card__chip','.orders-card__action','.orders-detail-modal__primary-action','.orders-detail-modal__reprint','.cashier-subnav__button']) {
      const elements=page.locator(selector);
      for (const element of await elements.all()) expect(await ratio(element),selector).toBeGreaterThanOrEqual(4.5);
    }
    const action=page.locator('.orders-card__action').first();
    await action.hover();
    expect(await ratio(action)).toBeGreaterThanOrEqual(4.5);
    await page.locator('.orders-detail-modal__primary-action').hover();
    expect(await ratio(page.locator('.orders-detail-modal__primary-action'))).toBeGreaterThanOrEqual(4.5);
    await action.focus();
    expect(await action.evaluate(el=>getComputedStyle(el).outlineStyle)).toBe('solid');
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
    await page.mouse.move(0,0);
    await page.screenshot({path:test.info().outputPath(`cores-${theme}-${scale}.png`),fullPage:true});
  });
}

for (const theme of ['dark','light']) {
  test(`real orders workspace preserves one-click printer in ${theme}`,async ({page})=>{
    await page.addInitScript(theme=>localStorage.setItem('@koma:theme',theme),theme);
    const scenario=await openOperationalScenario(page);
    const card=page.locator('.orders-card--salon').first();
    await expect(card).toBeVisible();
    await expect(card).toContainText('Prato em preparo');
    await page.screenshot({path:test.info().outputPath(`vendas-${theme}.png`),fullPage:true});
    await card.getByRole('button',{name:/Imprimir conferência/}).click();
    await expect.poll(()=>scenario.actions.filter(action=>action.path.includes('imprimir')).length).toBe(1);
    await expect(page.locator('.orders-detail-modal')).toHaveCount(0);
  });
}
