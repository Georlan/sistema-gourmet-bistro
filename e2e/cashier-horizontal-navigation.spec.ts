import { expect, test } from '@playwright/test';
import { mockCashierBackend, seedCashierSession } from './fixtures/cashier';

test('restored attendance is visible, keeps permissions collapsed and preserves tax without writes', async ({ page }) => {
  await mockCashierBackend(page);
  await seedCashierSession(page);
  await page.addInitScript(() => {
    sessionStorage.setItem('koma_active_tab', 'impressao_salao');
    sessionStorage.setItem('koma_active_subtab', 'taxa');
  });
  const writes: string[] = [];
  page.on('request', request => { if (request.url().includes('/caixa/configuracoes') && request.method() !== 'GET') writes.push(request.method()); });
  await page.goto('/?view=caixa');
  const nav = page.getByRole('navigation', { name: 'Telas desta área' });
  await expect(nav.getByRole('button', { name: 'Atendimento', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('checkbox', { name: 'Cobrar taxa de serviço' })).toBeVisible();
  const permissions = page.locator('details').filter({ has: page.locator('summary', { hasText: 'App do Garçom — permissões' }) });
  await expect(permissions).not.toHaveAttribute('open');
  await permissions.locator('summary').click();
  await expect(page.getByRole('heading', { name: 'Permissões da equipe', exact: true })).toBeVisible();
  expect(writes).toEqual([]);
  await page.screenshot({ path: test.info().outputPath('atendimento.png'), fullPage: true });
  const selectedInside = await nav.locator('[aria-current="page"]').evaluate(element => {
    const bounds = element.getBoundingClientRect();
    const parent = element.parentElement!.getBoundingClientRect();
    return bounds.left >= parent.left - 1 && bounds.right <= parent.right + 1;
  });
  expect(selectedInside).toBe(true);
});

test('mobile scroll exposes delivery and retains order creation in the same strip', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockCashierBackend(page);
  await seedCashierSession(page);
  await page.goto('/?view=caixa');
  const nav = page.getByRole('navigation', { name: 'Telas desta área' });
  await expect(nav.locator('.cashier-subnav__button')).toHaveCount(6);
  await expect(nav.getByRole('button', { name: 'Ver próximas abas' })).toBeVisible();
  await nav.getByRole('button', { name: 'Ver próximas abas' }).click();
  await nav.getByRole('button', { name: 'Entregas', exact: true }).click();
  await expect(nav.getByRole('button', { name: 'Entregas', exact: true })).toHaveAttribute('aria-current', 'page');
  await nav.getByRole('button', { name: 'Novo pedido', exact: true }).click();
  await expect(nav.getByRole('button', { name: 'Novo pedido', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByPlaceholder('Buscar item, descrição ou código')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});

for (const [tab, subTab] of [
  ['operacao', 'pedidos'],
  ['relatorios', 'produtos'],
  ['impressao_salao', 'mesas'],
  ['cardapio_digital', 'cardapio_perfil'],
]) {
  test(`${tab}: manual scrolling keeps geometry and position at both edges`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockCashierBackend(page);
    await seedCashierSession(page);
    await page.addInitScript(({ tab, subTab }) => {
      sessionStorage.setItem('koma_active_tab', tab);
      sessionStorage.setItem('koma_active_subtab', subTab);
    }, { tab, subTab });
    await page.goto('/?view=caixa');
    const nav = page.getByRole('navigation', { name: 'Telas desta área' });
    const strip = nav.locator('.cashier-subnav__scroll');
    await expect(nav.locator('[aria-current="page"]')).toHaveCount(1);
    const selected = await nav.locator('[aria-current="page"]').getAttribute('data-navigation-id');
    // Wait for initial selection reveal/ResizeObserver before simulating the user.
    await expect.poll(() => strip.evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true);
    await page.waitForTimeout(250);
    const geometry = await strip.boundingBox();
    for (const edge of ['start', 'middle', 'end', 'middle', 'start'] as const) {
      const target = await strip.evaluate((el, edge) => {
        const max = el.scrollWidth - el.clientWidth;
        const target = edge === 'start' ? 0 : edge === 'end' ? max : Math.min(60, max / 2);
        el.scrollLeft = target;
        return target;
      }, edge);
      // Cross the scroll event, React state update and ResizeObserver cycle.
      await page.waitForTimeout(250);
      expect(await strip.evaluate(el => el.scrollLeft)).toBeCloseTo(target, 0);
      const bounds = await strip.boundingBox();
      expect(bounds!.x).toBeCloseTo(geometry!.x, 0);
      expect(bounds!.width).toBeCloseTo(geometry!.width, 0);
      await expect(nav.locator('[aria-current="page"]')).toHaveAttribute('data-navigation-id', selected!);
    }
    // Selecting another destination must still reveal it, including the last item.
    await nav.locator('.cashier-subnav__button').last().click();
    await expect.poll(() => nav.locator('[aria-current="page"]').evaluate(el => {
      const item = el.getBoundingClientRect();
      const viewport = el.parentElement!.getBoundingClientRect();
      return item.left >= viewport.left - 1 && item.right <= viewport.right + 1;
    })).toBe(true);
  });
}


test('native touch swipe in reports stays away from the selected tab until navigation', async ({ page, context }, testInfo) => {
  test.skip(!testInfo.project.use.hasTouch, 'Native touch input requires a touch viewport');
  await page.setViewportSize({ width: 390, height: 844 });
  await mockCashierBackend(page);
  await seedCashierSession(page);
  await page.addInitScript(() => {
    sessionStorage.setItem('koma_active_tab', 'relatorios');
    sessionStorage.setItem('koma_active_subtab', 'visao_geral');
  });
  await page.goto('/?view=caixa');
  const nav = page.getByRole('navigation', { name: 'Telas desta área' });
  const strip = nav.locator('.cashier-subnav__scroll');
  await expect(nav.locator('[aria-current="page"]')).toHaveCount(1);
  await page.waitForTimeout(250);
  const bounds = (await strip.boundingBox())!;
  const client = await context.newCDPSession(page);
  const y = bounds.y + bounds.height / 2;
  const x = bounds.x + bounds.width - 12;
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  for (let step = 1; step <= 8; step++) {
    await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x - step * 24, y }] });
    await page.waitForTimeout(30);
  }
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect.poll(() => strip.evaluate(el => el.scrollLeft)).toBeGreaterThan(80);
  await page.waitForTimeout(500);
  expect(await strip.evaluate(el => el.scrollLeft)).toBeGreaterThan(80);
  await expect(nav.locator('[aria-current="page"]')).toHaveAttribute('data-navigation-id', 'relatorios_visao_geral');
  const after = (await strip.boundingBox())!;
  expect(after.x).toBeCloseTo(bounds.x, 0);
  expect(after.width).toBeCloseTo(bounds.width, 0);
  await page.screenshot({ path: testInfo.outputPath('reports-after-touch-swipe.png') });
  await client.detach();
});
