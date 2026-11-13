import { expect, test, type Page } from '@playwright/test';
import { mockCashierBackend, seedCashierSession } from './fixtures/cashier';

async function openNewOrder(page: Page) {
  await mockCashierBackend(page);
  await seedCashierSession(page);
  await page.addInitScript(() => {
    sessionStorage.setItem('koma_active_tab', 'operacao');
    sessionStorage.setItem('koma_active_subtab', 'balcao');
  });
  await page.goto('/?view=caixa');
  await expect(page.getByPlaceholder('Buscar item, descrição ou código')).toBeVisible();
}

function contrast(text: string, background: string) {
  const components = (value: string) => {
    const values = value.match(/[\d.]+/g)?.slice(0, 3).map(Number) ?? [];
    if (values.length !== 3) throw new Error(`Cannot resolve color ${value}`);
    return values;
  };
  const luminance = (rgb: number[]) => rgb.map(v => {
    const n = v / 255;
    return n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
  }).reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
  const l1 = luminance(components(text));
  const l2 = luminance(components(background));
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

// Only colors change. Important cart/picker workflows must keep their owners.
test('PDV theme hierarchy keeps selected mode subdued, secondary action distinct and CTA contrast-safe', async ({ page }, info) => {
  for (const theme of ['dark', 'light'] as const) {
    await page.setViewportSize({ width: 390, height: 740 });
    await openNewOrder(page);
    await page.evaluate(theme => { document.documentElement.dataset.komaTheme = theme; }, theme);
    await page.getByRole('button', { name: 'Adicionar Risoto da casa rapidamente' }).click();
    const catalog = page.locator('.cashier-pdv-category[aria-pressed="true"]').first();
    const secondaryAction = page.getByRole('button', { name: 'Adicionar Risoto da casa rapidamente' });
    const catalogColors = await catalog.evaluate(el => ({ text: getComputedStyle(el).color, bg: getComputedStyle(el).backgroundColor }));
    const secondaryColors = await secondaryAction.evaluate(el => ({ text: getComputedStyle(el).color, bg: getComputedStyle(el).backgroundColor }));
    expect(contrast(catalogColors.text, catalogColors.bg)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(secondaryColors.text, secondaryColors.bg)).toBeGreaterThanOrEqual(4.5);
    await page.locator('#pdv-review-btn').click();
    const option = page.locator('.cashier-pdv-cart__modality-option[aria-pressed="true"]');
    const submit = page.locator('#pdv-submit-btn');
    await expect(option).toBeVisible();
    const colors = await page.evaluate(() => {
      const choice = document.querySelector<HTMLElement>('.cashier-pdv-cart__modality-option[aria-pressed="true"]')!;
      const button = document.querySelector<HTMLElement>('#pdv-submit-btn')!;
      const amount = document.querySelector<HTMLElement>('.cashier-pdv-cart__total-value strong')!;
      const panel = document.querySelector<HTMLElement>('.cashier-pdv-cart__footer')!;
      const main = document.querySelector<HTMLElement>('.cashier-pdv-view')!;
      const resolve = (el: HTMLElement) => ({ color: getComputedStyle(el).color, bg: getComputedStyle(el).backgroundColor });
      return { choice: resolve(choice), submit: resolve(button), amount: resolve(amount), panel: resolve(panel), canvas: resolve(main) };
    });
    expect(colors.choice.bg).not.toBe(colors.submit.bg);
    expect(colors.choice.bg).not.toBe(colors.panel.bg);
    expect(contrast(colors.choice.color, colors.choice.bg)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(colors.submit.color, colors.submit.bg)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(colors.amount.color, colors.panel.bg)).toBeGreaterThanOrEqual(4.5);
    await expect(submit).toBeEnabled();
    await expect(page.locator('.cashier-pdv-cart__total')).toContainText('R$ 42,00');
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    if (process.env.KOMA_CAPTURE_UI) await page.screenshot({ path: info.outputPath(`pdv-${theme}-palette-390.png`) });
    await option.focus();
    await expect(option).toBeFocused();
    await page.locator('.cashier-pdv-cart__modality-option').filter({ hasText: 'Consumo local' }).click();
    await expect(page.locator('.cashier-pdv-cart__modality-option').filter({ hasText: 'Consumo local' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#pdv-target-table')).toBeVisible();
    const localColors = await page.locator('.cashier-pdv-cart__modality-option[aria-pressed="true"]').evaluate(el => ({ color: getComputedStyle(el).color, bg: getComputedStyle(el).backgroundColor }));
    expect(contrast(localColors.color, localColors.bg)).toBeGreaterThanOrEqual(4.5);
    if (process.env.KOMA_CAPTURE_UI) await page.screenshot({ path: info.outputPath(`pdv-${theme}-local-390.png`) });
    await page.locator('.cashier-pdv-cart__modality-option').filter({ hasText: 'Retirada' }).click();
    await page.locator('.cashier-pdv-service-detail').filter({ hasText: 'Pagamento' }).locator('summary').click();
    const pix = page.getByRole('group', { name: 'Forma de pagamento' }).getByRole('button', { name: 'Pix' });
    await pix.click();
    const paymentColors = await pix.evaluate(el => ({ color: getComputedStyle(el).color, bg: getComputedStyle(el).backgroundColor }));
    expect(contrast(paymentColors.color, paymentColors.bg)).toBeGreaterThanOrEqual(4.5);
    await expect(pix).toHaveAttribute('aria-pressed', 'true');
  }
});

test('PDV tonal mode remains responsive and accessible at 320 and 430px with the same order flow', async ({ page }) => {
  for (const width of [320, 430]) {
    await page.setViewportSize({ width, height: 660 });
    await openNewOrder(page);
    await page.getByRole('button', { name: 'Adicionar Risoto da casa rapidamente' }).click();
    await page.locator('#pdv-review-btn').click();
    const submit = page.locator('#pdv-submit-btn');
    await expect(submit).toBeInViewport();
    const choice = page.locator('.cashier-pdv-cart__modality-option').filter({ hasText: 'Delivery' });
    await choice.click();
    await expect(choice).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#pdv-delivery-address-logradouro')).toBeVisible();
    await expect(submit).toBeInViewport();
    await page.getByRole('button', { name: 'Escolher itens' }).click();
    await expect(page.locator('#pdv-review-btn')).toBeInViewport();
    await page.locator('#pdv-review-btn').click();
    await expect(choice).toHaveAttribute('aria-pressed', 'true');
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  }
});
