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

for (const width of [390, 1366]) for (const scale of [1, 1.4]) for (const theme of ['dark', 'light']) {
  test(`order items and main action are visible at ${width}px scale ${scale} ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 768 });
    await page.goto(`/e2e/fixtures/order-details-layout.html?scale=${scale}&theme=${theme}`);
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name:'Pedido #107' })).toBeVisible();
    await expect(dialog.getByText('Ana Teste', {exact:true})).toHaveCount(1);
    await expect(dialog.getByText('11900000000', {exact:true})).toBeVisible();
    await expect(dialog.getByText('Restaurante de teste', {exact:false})).toBeVisible();
    await expect(dialog.getByRole('textbox')).toHaveCount(0);
    expect(await ratio(dialog.getByText('Pagamento no atendimento', {exact:true}))).toBeGreaterThanOrEqual(4.5);
    await expect(dialog.getByRole('button', { name:'Marcar como pronto', exact:true })).toBeInViewport();
    await expect(dialog.locator('.orders-detail-modal__item').first()).toBeInViewport();
    expect(await dialog.evaluate(el=>el.scrollHeight <= el.clientHeight+1)).toBe(true);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
    const body = dialog.locator('.orders-detail-modal__body');
    if (width===1366) expect(await body.evaluate(el=>el.scrollHeight<=el.clientHeight+1)).toBe(true);
    await dialog.getByRole('button', { name:'Marcar como pronto', exact:true }).click();
    expect(await page.evaluate(()=>(window as any).detailCalls[0].action)).toBe('advanceDigitalOrder');
    await dialog.getByText('Mais opções', {exact:true}).click();
    await dialog.getByRole('button', {name:'Reimprimir produção',exact:true}).click();
    expect(await page.evaluate(()=>(window as any).detailCalls[1].action)).toBe('reprintProduction');
    await dialog.getByText('Mais opções', {exact:true}).click();
    await page.screenshot({path:test.info().outputPath(`pedido-${width}-${scale}-${theme}.png`)});
  });
}

test('grouped items retain separate editable identities and failed drafts', async ({page})=>{
  await page.goto('/e2e/fixtures/order-details-layout.html?grouped=1&fail=1');
  const row=page.locator('.orders-detail-modal__item');
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('2×');
  await row.getByText('Editar observação', {exact:true}).click();
  const second=page.getByLabel('Observação — Combo Bacon · Unidade 2');
  await second.fill('Sem pimenta');
  await second.locator('..').locator('..').getByRole('button',{name:'Salvar observação'}).click();
  await expect(page.getByText('Falha controlada ao salvar')).toBeVisible();
  await expect(second).toHaveValue('Sem pimenta');
  await expect(page.getByLabel('Observação — Combo Bacon · Unidade 1')).toHaveValue('Sem sal');
  expect(await page.evaluate(()=>(window as any).detailCalls)).toEqual([{action:'observation',id:'combo-2',value:'Sem pimenta'}]);
});
