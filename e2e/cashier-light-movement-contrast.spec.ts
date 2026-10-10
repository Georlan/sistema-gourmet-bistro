import { expect, test, type Locator } from '@playwright/test';

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

for (const theme of ['light', 'dark']) for (const movement of ['transfer', 'merge']) {
  test(`aviso ${movement} mantém texto e título legíveis em ${theme}`, async ({ page }) => {
    await page.goto(`/e2e/fixtures/kanban-contrast.html?theme=${theme}&movement=${movement}`);
    const title = page.locator('.orders-detail-modal').getByText(movement === 'transfer' ? 'Consumo Transferido:' : 'Consumo Mesclado:', { exact: true });
    const body = page.locator('.orders-detail-modal').getByText(movement === 'transfer' ? /Este lote foi transferido/ : /Este lote possui consumo mesclado/);
    await expect(title).toBeVisible();
    await expect(body).toContainText('Mesa 3');
    expect(await ratio(title)).toBeGreaterThanOrEqual(4.5);
    expect(await ratio(body)).toBeGreaterThanOrEqual(4.5);
    if (process.env.LIGHT_SCREENSHOTS) await page.screenshot({ path: `${process.env.LIGHT_SCREENSHOTS}/aviso-${movement}-${theme}-${test.info().project.name}.png` });
  });
}
