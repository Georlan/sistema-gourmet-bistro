import { expect, test } from '@playwright/test';
import { API_ORIGIN, openOperationalScenario } from './fixtures/operational';

const rgb = (value: string): number[] => {
  const match = value.match(/rgba?\((\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (!match) throw new Error(`Cor inesperada: ${value}`);
  return match.slice(1).map(Number);
};
const contrast = (foreground: string, background: string) => {
  const luminance = (value: string) => {
    const channels = rgb(value).map(v => {
      const c = v / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  };
  const [a, b] = [luminance(foreground), luminance(background)].sort((x, y) => y - x);
  return (a + 0.05) / (b + 0.05);
};

async function computedColors(page: import('@playwright/test').Page, selector: string) {
  return page.locator(selector).first().evaluate((node) => {
    const css = getComputedStyle(node);
    return {
      background: css.backgroundColor,
      foreground: css.color,
      border: css.borderTopColor,
      stateSurface: css.getPropertyValue('--table-face').trim(),
      stateCap: css.getPropertyValue('--table-cap').trim(),
      stateInk: css.getPropertyValue('--table-text').trim(),
    };
  });
}

test('Salão uses canonical preparation/ready/free/pay colors with legible status in both themes', async ({ page }, testInfo) => {
  await openOperationalScenario(page, { subtab: 'mesas', statuses: ['preparando', 'pronto'], tableCount: 8 });
  const ready = page.locator('.koma-salon-card[data-operational-state="ready"]');
  const free = page.locator('.koma-salon-card[data-operational-state="free"]').first();
  await expect(ready).toHaveCount(1);
  await expect(ready).toContainText('Tem item pronto');
  await expect(free).toContainText('Livre');
  for (const theme of ['dark', 'light'] as const) {
    await page.evaluate(theme => { document.documentElement.dataset.komaTheme = theme; }, theme);
    const freeColors = await computedColors(page, '.koma-salon-card[data-operational-state="free"]');
    const readyColors = await computedColors(page, '.koma-salon-card[data-operational-state="ready"]');
    expect(freeColors.background).not.toBe(readyColors.background);
    expect(freeColors.border).not.toBe(readyColors.border);
    for (const state of ['free', 'ready'] as const) {
      const card = page.locator(`.koma-salon-card[data-operational-state="${state}"]`).first();
      const head = await card.locator('.koma-salon-card__identity').evaluate(node => ({ fg: getComputedStyle(node).color, bg: getComputedStyle(node).backgroundColor }));
      const status = await card.locator('.koma-table-state-mark').evaluate(node => getComputedStyle(node).color);
      const body = await card.locator('.koma-salon-card__context').evaluate(node => getComputedStyle(node).backgroundColor);
      const surface = (await computedColors(page, `.koma-salon-card[data-operational-state="${state}"]`)).background;
      expect(contrast(head.fg, head.bg)).toBeGreaterThanOrEqual(4.5);
      const ratio = contrast(status, body === 'rgba(0, 0, 0, 0)' ? surface : body);
      expect(ratio).toBeGreaterThanOrEqual(4.5);
    }
    if (process.env.KOMA_CAPTURE_UI) await page.screenshot({ path: testInfo.outputPath(`salon-${theme}-states.png`) });
  }
});

test('Occupied tables visibly differ from free and ready without changing state rules', async ({ page }, testInfo) => {
  await openOperationalScenario(page, { subtab: 'mesas', statuses: ['preparando'], tableCount: 8 });
  const occupied = page.locator('.koma-salon-card[data-operational-state="occupied"]');
  await expect(occupied).toHaveCount(1);
  await expect(occupied).toContainText('Em preparo');
  for (const theme of ['light', 'dark'] as const) {
    await page.evaluate(theme => { document.documentElement.dataset.komaTheme = theme; }, theme);
    const occupiedColors = await computedColors(page, '.koma-salon-card[data-operational-state="occupied"]');
    const freeColors = await computedColors(page, '.koma-salon-card[data-operational-state="free"]');
    expect(occupiedColors.background).not.toBe(freeColors.background);
    const header = await occupied.locator('.koma-salon-card__identity').evaluate(node => ({ fg: getComputedStyle(node).color, bg: getComputedStyle(node).backgroundColor }));
    expect(contrast(header.fg, header.bg)).toBeGreaterThanOrEqual(4.5);
    if (process.env.KOMA_CAPTURE_UI) await page.screenshot({path: testInfo.outputPath(`occupied-${theme}.png`)});
  }
});

test('PDV modal and chosen table share state, selected highlight, keyboard and no production writes', async ({ page }, testInfo) => {
  const state = await openOperationalScenario(page, { subtab: 'mesas', statuses: ['preparando', 'pronto'], tableCount: 8 });
  await page.locator('.koma-salon-card[data-table-status="free"]').first().getByRole('button', { name: /Abrir pedido/ }).click();
  const context = page.getByTestId('pdv-selected-table-context');
  await expect(context).toHaveAttribute('data-operational-state', 'free');
  await context.getByRole('button', { name: 'Trocar mesa' }).click();
  const dialog = page.getByRole('dialog', { name: 'Escolher mesa' });
  const occupied = dialog.locator('.koma-table-picker__tile[data-operational-state="ready"]');
  await expect(occupied).toHaveCount(1);
  await expect(occupied).toContainText('Tem item pronto');
  await expect(occupied).toContainText('R$ 160,00');
  const readyStatusText = occupied.locator('.koma-table-state-mark > span:last-child');
  const statusTextWidth = await readyStatusText.evaluate(node => node.getBoundingClientRect().width);
  expect(statusTextWidth).toBeGreaterThan(65); // Legacy CSS once gave all descendant spans a 0.4rem width.

  await occupied.click();
  await expect(context).toHaveAttribute('data-operational-state', 'ready');
  await expect(context).toContainText('Tem item pronto');
  await expect(context).toContainText('R$ 160,00');
  if (process.env.KOMA_CAPTURE_UI) await page.screenshot({path: testInfo.outputPath('pdv-selected-ready-context.png')});
  const cartButton = page.getByRole('button', { name: /^Carrinho \(/ });
  if (await cartButton.isVisible()) await cartButton.click();
  const trigger = page.locator('#pdv-target-table');
  await expect(trigger).toHaveAttribute('data-operational-state', 'ready');
  await expect(trigger).toContainText('Tem item pronto');
  await trigger.click();
  await expect(dialog.locator('.koma-table-picker__tile[aria-pressed="true"]')).toHaveAttribute('data-operational-state', 'ready');
  for (const theme of ['dark', 'light'] as const) {
    await page.evaluate(theme => { document.documentElement.dataset.komaTheme = theme; }, theme);
    const readyColor = await computedColors(page, '.koma-table-picker__tile[data-operational-state="ready"]');
    const freeColor = await computedColors(page, '.koma-table-picker__tile[data-operational-state="free"]');
    expect(readyColor.background).not.toBe(freeColor.background);
    if (process.env.KOMA_CAPTURE_UI) await page.screenshot({ path: testInfo.outputPath(`picker-${theme}-selected.png`) });
  }
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  expect(state.actions.filter(a => /comandas\/.*(lancamentos|pagar)|transferir/.test(a.path))).toEqual([]);
});

test('Responsive table picker and Salão fit 320/390/430 without reducing touch targets', async ({page}) => {
  await openOperationalScenario(page, { subtab: 'mesas', tableCount: 8 });
  for (const width of [320, 390, 430]) {
    await page.setViewportSize({ width, height: 740 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
    await page.locator('.koma-salon-card[data-table-status="free"]').first().getByRole('button', { name: /Abrir pedido/ }).click();
    await page.getByTestId('pdv-selected-table-context').getByRole('button', { name: 'Trocar mesa' }).click();
    const dialog = page.getByRole('dialog', { name: 'Escolher mesa' });
    await expect(dialog.locator('.koma-table-picker__tile').first()).toBeVisible();
    const box = await dialog.locator('.koma-table-picker__tile').first().boundingBox();
    expect(box!.width).toBeGreaterThanOrEqual(95);
    expect(box!.height).toBeGreaterThanOrEqual(120);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Salão', exact: true }).first().click();
  }
});


test('Payment state takes precedence over production in Salão and PDV picker', async ({ page }) => {
  await openOperationalScenario(page, { subtab: 'mesas', statuses: ['preparando'], checkStatus: 'aguardando_pagamento' });
  const pending = page.locator('.koma-salon-card[data-operational-state="payment"]');
  await expect(pending).toHaveCount(1);
  await expect(pending).toContainText('Aguardando pagamento');
  await page.locator('.koma-salon-card[data-table-status="free"]').first().getByRole('button', { name: /Abrir pedido/ }).click();
  await page.getByTestId('pdv-selected-table-context').getByRole('button', { name: 'Trocar mesa' }).click();
  const tile = page.locator('#pdv-table-picker .koma-table-picker__tile[data-operational-state="payment"]');
  await expect(tile).toHaveCount(1);
  await expect(tile).toContainText('Aguardando pagamento');
  await tile.click();
  await expect(page.getByTestId('pdv-selected-table-context')).toHaveAttribute('data-operational-state', 'payment');
});


test('Transfer destination shows occupied versus free with same rose/green semantics and keeps confirmation explicit', async ({ page }, testInfo) => {
  const fixture = await openOperationalScenario(page, { subtab: 'mesas' });
  await page.route(`${API_ORIGIN}/mesas/`, route => route.fulfill({ json: [
    { id: 7, nome: 'Mesa 7', capacidade: 4, status: 'ocupada' },
    { id: 8, nome: 'Varanda', capacidade: 4, status: 'ocupada' },
    { id: 9, nome: 'Mesa 9', capacidade: 4, status: 'livre' },
  ] }));
  await page.reload();
  await page.getByRole('button', { name: 'Ver comanda' }).first().click();
  await page.locator('.orders-detail-modal').getByRole('button', { name: 'Transferir', exact: true }).click();
  const picker = page.getByRole('radiogroup', { name: 'Mesa de destino' });
  const occupied = picker.getByRole('radio', { name: 'Mesa 8 · Varanda · ocupada', exact: true });
  const free = picker.getByRole('radio', { name: 'Mesa 9 · livre', exact: true });
  await expect(occupied).toHaveAttribute('data-operational-state', 'occupied');
  await expect(free).toHaveAttribute('data-operational-state', 'free');
  await expect(occupied).toContainText('Ocupada');
  await expect(free).toContainText('Livre');
  for (const theme of ['dark', 'light'] as const) {
    await page.evaluate(theme => { document.documentElement.dataset.komaTheme = theme; }, theme);
    const occupiedColors = await computedColors(page, '.kd-destination-grid > [role="radio"][data-occupied="true"]');
    const freeColors = await computedColors(page, '.kd-destination-grid > [role="radio"][data-occupied="false"]');
    expect(occupiedColors.background).not.toBe(freeColors.background);
    const status = await occupied.locator('.koma-table-state-mark').evaluate(node => getComputedStyle(node).color);
    expect(contrast(status, occupiedColors.background)).toBeGreaterThanOrEqual(4.5);
    if (process.env.KOMA_CAPTURE_UI) await page.screenshot({ path: testInfo.outputPath(`transfer-${theme}.png`) });
  }
  await occupied.click();
  await expect(occupied).toHaveAttribute('aria-checked', 'true');
  expect(fixture.actions.filter(a => a.path.includes('/transferir/'))).toHaveLength(0);
});
