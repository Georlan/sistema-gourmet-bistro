import { expect, test, type Page } from '@playwright/test';
import { mockCashierBackend, seedCashierSession } from './fixtures/cashier';

async function navigate(page: Page, area: string) {
  if (!await page.locator('.cashier-sidebar:visible').isVisible()) await page.getByRole('button', { name: 'Abrir menu principal' }).click();
  await page.locator('.cashier-sidebar:visible').getByRole('button', { name: new RegExp(`^${area}(?: \\d+)?$`) }).first().click();
}
async function setSize(page: Page, size: string) {
  await page.evaluate(size => {
    localStorage.setItem('koma_font_size', size);
    window.dispatchEvent(new Event('koma_font_size_changed'));
  }, size);
  await expect(page.locator('html')).toHaveAttribute('data-koma-text-size', size);
}
for (const width of [360, 390, 1366]) {
  test(`all operator workspaces scale text without page overflow at ${width}px`, async ({ page }) => {
    test.setTimeout(60000);
    await page.setViewportSize({ width, height: width === 390 ? 844 : 768 });
    await mockCashierBackend(page);
    await seedCashierSession(page);
    await page.goto('/?view=caixa');
    const areas = ['Vendas', 'Caixa', 'Cardápio', 'Cardápio online', 'Estoque & compras', 'Clientes', 'Relatórios', 'Equipe', 'Configurações', 'Conta & assinatura'];
    const baseSizes: Record<string, number> = {};
    for (const [size, scale] of [['padrao', 1], ['grande', 1.2], ['gigante', 1.4]] as const) {
      await setSize(page, size);
      for (const area of areas) {
        await navigate(page, area);
        const button = page.locator('.cashier-subnav__button').first();
        await expect(button).toBeVisible();
        const font = await button.evaluate(el => parseFloat(getComputedStyle(el).fontSize));
        if (size === 'padrao') baseSizes[area] = font;
        else expect(font / baseSizes[area], area).toBeCloseTo(scale, 1);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${size} ${area}`).toBe(true);
        const clipped = await button.evaluate(el => el.scrollHeight > el.clientHeight + 2);
        expect(clipped, `${size} ${area} tab height`).toBe(false);
      }
    }
    await navigate(page, 'Vendas');
    await page.locator('.cashier-subnav').getByRole('button', { name: 'Novo pedido', exact: true }).click();
    await expect(page.getByPlaceholder('Buscar item, descrição ou código')).toBeVisible();
    const add = page.locator('.cashier-pdv-product-actions > button').first();
    expect(await add.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    expect(await page.locator('.cashier-pdv-product-actions > span').first().evaluate(el => el.getClientRects().length)).toBe(1);
    await page.screenshot({ path: test.info().outputPath(`texto-gigante-${width}.png`), fullPage: true });
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-koma-text-size', 'gigante');
  });
}

test('real preference controls scale summaries and portal dialogs, and reset the default', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockCashierBackend(page);
  await seedCashierSession(page);
  await page.goto('/?view=caixa');
  await page.getByRole('button', { name: 'Ver resumo da tela' }).click();
  const summaryTitle = page.getByRole('dialog').getByRole('heading', { name: 'Resumo da tela' });
  const baseSummary = await summaryTitle.evaluate(el => parseFloat(getComputedStyle(el).fontSize));
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Abrir menu principal' }).click();
  await page.getByRole('button', { name: 'Abrir conta e preferências' }).click();
  const options = page.locator('.cashier-options');
  await options.getByRole('button', { name: 'Gigante', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-koma-text-size', 'gigante');
  await options.getByRole('button', { name: 'Gigante', exact: true }).click();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Ver resumo da tela' }).click();
  expect(await summaryTitle.evaluate(el => parseFloat(getComputedStyle(el).fontSize)) / baseSummary).toBeCloseTo(1.4, 1);
  await page.keyboard.press('Escape');
  await navigate(page, 'Equipe');
  await page.getByRole('button', { name: 'Convidar pessoa', exact: true }).click();
  const invite = page.getByRole('dialog', { name: 'Convidar para a equipe' });
  await expect(invite).toBeVisible();
  expect(await invite.getByRole('heading').evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBeCloseTo(25.2, 1);
  expect(await invite.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  await invite.getByRole('button', { name: 'Fechar convite' }).click();
  await setSize(page, 'padrao');
  await expect(page.locator('html')).toHaveAttribute('data-koma-text-size', 'padrao');
});
