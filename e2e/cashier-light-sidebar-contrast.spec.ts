import { expect, test, type Locator } from '@playwright/test';
import { mockCashierBackend, seedCashierSession } from './fixtures/cashier';

function channelToLinear(channel: number) {
  const normalized = channel / 255;
  return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
}

function luminance(rgb: [number, number, number]) {
  return 0.2126 * channelToLinear(rgb[0])
    + 0.7152 * channelToLinear(rgb[1])
    + 0.0722 * channelToLinear(rgb[2]);
}

function parseRgb(value: string): [number, number, number] {
  const channels = value.match(/[\d.]+/g)?.slice(0, 3).map(Number) ?? [];
  if (channels.length !== 3) throw new Error(`Cor CSS inesperada: ${value}`);
  return channels as [number, number, number];
}

async function contrastRatio(locator: Locator) {
  const { color, backgroundColor } = await locator.evaluate((element) => {
    const style = getComputedStyle(element);
    return { color: style.color, backgroundColor: style.backgroundColor };
  });
  const foreground = luminance(parseRgb(color));
  const background = luminance(parseRgb(backgroundColor));
  const lighter = Math.max(foreground, background);
  const darker = Math.min(foreground, background);
  return (lighter + 0.05) / (darker + 0.05);
}

test('sidebar do Caixa mantém controles persistentes legíveis no tema claro', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await mockCashierBackend(page);
  await seedCashierSession(page);
  await page.routeWebSocket(/\/ws\//, socket => socket.onMessage(() => {}));
  await page.route('**/api/online-orders/control', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      paused: false,
      pause_reason: null,
      pause_until: null,
      max_active_orders: null,
      auto_pause: false,
      counts: { analise: 2, pendente: 4, producao: 0, pronto: 0, active: 6 },
      capacity_ratio: null,
      level: 'normal',
    }),
  }));
  await page.addInitScript(() => localStorage.setItem('@koma:theme', 'light'));

  await page.goto('/?view=caixa');
  await expect(page.locator('html')).toHaveAttribute('data-koma-theme', 'light');

  const emergency = page.locator('#online-orders-emergency-trigger');
  await expect(emergency).toBeVisible();
  await expect(emergency).toContainText('Pausar cardápio online');
  expect(await contrastRatio(emergency)).toBeGreaterThanOrEqual(4.5);

  const textLabel = page.getByText('Texto', { exact: true }).last();
  const themeLabel = page.getByText('Tema', { exact: true }).last();
  const operatorLabel = page.getByText('Operador', { exact: true }).last();
  await expect(textLabel).toBeVisible();
  await expect(themeLabel).toBeVisible();
  await expect(operatorLabel).toBeVisible();

  const secondary = 'rgb(51, 65, 85)';
  await expect(textLabel).toHaveCSS('color', secondary);
  await expect(themeLabel).toHaveCSS('color', secondary);
  await expect(operatorLabel).toHaveCSS('color', secondary);

  const fontOptions = page.locator('.cashier-font-control__options').first();
  await expect(fontOptions).toHaveCSS('border-color', 'rgb(148, 163, 184)');
  const inactiveFont = page.getByRole('button', { name: 'Texto grande' });
  await expect(inactiveFont).toHaveCSS('color', secondary);
});
