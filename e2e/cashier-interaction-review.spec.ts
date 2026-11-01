import { expect, test } from '@playwright/test';
import { openOperationalScenario, showStage } from './fixtures/operational';

test('details use the shared typography, format time, keep focus and return without writes', async ({ page }) => {
  const scenario = await openOperationalScenario(page);
  await showStage(page, 'Salão');
  const card = page.locator('.orders-card--salon').first();
  await card.focus();
  await card.click();
  const dialog = page.getByRole('dialog', { name: /Mesa|Consumo/ });
  await expect(dialog).toBeVisible();
  await expect(page.getByRole('button', { name: 'Fechar detalhes', exact: true })).toBeFocused();
  await dialog.locator('.kd-items-disclosure > summary').click();
  for (const selector of ['.orders-detail-modal__eyebrow', '.orders-detail-modal__item-status']) {
    expect(await dialog.locator(selector).first().evaluate(el => getComputedStyle(el).fontFamily)).toContain('Inter');
  }
  expect(await dialog.locator('.orders-detail-modal__title').evaluate(el => getComputedStyle(el).fontFamily)).toContain('Space Grotesk');
  await expect(dialog.locator('.orders-detail-modal__eyebrow')).not.toContainText(/T\d\d:\d\d:\d\d/);
  await page.getByRole('button', { name: 'Fechar detalhes', exact: true }).focus();
  await page.keyboard.press('Shift+Tab');
  expect(await dialog.evaluate(el => el.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Fechar detalhes', exact: true })).toBeFocused();
  await expect(dialog.getByRole('button', { name: /Reimprimir|Conta Total/ }).first()).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(card).toBeFocused();
  await card.click();
  await page.mouse.click(4, 4);
  await expect(dialog).toHaveCount(0);
  expect(scenario.actions).toHaveLength(0);
});

test('header theme has a hover preview without changing theme and actions remain usable', async ({ page, isMobile }) => {
  await openOperationalScenario(page);
  await expect(page.locator('.cashier-topbar [data-sidebar="trigger"]')).toHaveCount(0);
  const theme = page.locator('#btn-caixa-theme');
  const initial = await page.locator('html').getAttribute('data-koma-theme');
  if (!isMobile) {
    const moon = theme.locator('.cashier-theme-toggle__moon');
    const before = await moon.evaluate(el => getComputedStyle(el).opacity);
    await theme.hover();
    await expect.poll(() => moon.evaluate(el => getComputedStyle(el).opacity)).not.toBe(before);
    await expect(page.locator('html')).toHaveAttribute('data-koma-theme', initial!);
  }
  await expect(page.locator('#btn-caixa-resumo')).toHaveCount(0);
  await page.locator('#btn-caixa-conversas-drawer').click();
  await expect(page.getByText('Central de Conversas', { exact: true })).toBeVisible();
});

test('desktop sidebar drags both ways and supports keyboard without a header toggle', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  const scenario = await openOperationalScenario(page);
  const rail = page.getByRole('separator', { name: /Largura do menu/ });
  await expect(rail).toHaveAttribute('aria-valuenow', '1');
  let bounds = (await rail.boundingBox())!;
  await page.mouse.move(bounds.x + bounds.width / 2, 300);
  await page.mouse.down();
  const initialWidth = await page.locator('.cashier-sidebar').last().evaluate(el => el.getBoundingClientRect().width);
  await page.mouse.move(bounds.x - 85, 302, { steps: 6 });
  await expect.poll(() => page.locator('.cashier-sidebar').last().evaluate(el => el.getBoundingClientRect().width)).toBeLessThan(initialWidth - 30);
  await expect(rail).toHaveAttribute('aria-valuenow', '1');
  expect(await page.locator('.cashier-sidebar > [data-sidebar=sidebar]').last().evaluate(el => el.getBoundingClientRect().width)).toBeGreaterThan(initialWidth - 3);
  await page.mouse.up();
  await expect(rail).toHaveAttribute('aria-valuenow', '0');
  // A click is not a swipe.
  await rail.click();
  await expect(rail).toHaveAttribute('aria-valuenow', '0');
  bounds = (await rail.boundingBox())!;
  await page.mouse.move(bounds.x + bounds.width / 2, 300);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 100, 302, { steps: 6 });
  await page.mouse.up();
  await expect(rail).toHaveAttribute('aria-valuenow', '1');
  await rail.focus();
  await page.keyboard.press('ArrowLeft');
  await expect(rail).toHaveAttribute('aria-valuenow', '0');
  await page.keyboard.press('ArrowRight');
  await expect(rail).toHaveAttribute('aria-valuenow', '1');
  const nav = page.getByRole('navigation', { name: 'Telas desta área' });
  const first = (await nav.locator('.cashier-subnav__button').first().boundingBox())!;
  const header = (await page.locator('.cashier-topbar').boundingBox())!;
  expect(first.x - header.x).toBeLessThan(25);
  expect(scenario.actions).toHaveLength(0);
});

test('mobile sidebar supports horizontal touch intent and preserves vertical scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const scenario = await openOperationalScenario(page);
  const edge = page.locator('.cashier-sidebar__edge');
  const touch = await page.context().newCDPSession(page);
  const swipe = async (x: number, y: number, endX: number, endY: number) => {
    await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: endX, y: endY }] });
    await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  };
  await expect(edge).toBeVisible();
  await swipe(5, 250, 100, 255);
  await expect(page.getByRole('dialog', { name: 'Menu principal' })).toBeVisible();
  const menu = page.locator('#mobile-caixa-sidebar');
  await swipe(180, 15, 170, 100);
  await expect(menu).toBeVisible();
  await swipe(180, 15, 70, 17);
  await expect(menu).toHaveCount(0);
  await page.locator('#btn-mobile-caixa-sidebar-open').click();
  await expect(menu).toBeVisible();
  expect(scenario.actions).toHaveLength(0);
});

test('all six operation destinations keep selection, show their screen, and fullscreen can return', async ({ page, isMobile }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const scenario = await openOperationalScenario(page);
  const nav = page.getByRole('navigation', { name: 'Telas desta área' });
  for (const name of ['Novo pedido', 'Salão', 'Cozinha', 'Retiradas', 'Entregas', 'Pedidos']) {
    await nav.getByRole('button', { name, exact: true }).click();
    await expect(nav.getByRole('button', { name, exact: true })).toHaveAttribute('aria-current', 'page');
    if (name === 'Novo pedido') await expect(page.getByPlaceholder('Buscar item, descrição ou código')).toBeVisible();
    if (name === 'Pedidos') await expect(page.locator('.orders-board')).toBeVisible();
  }
  if (!isMobile) {
    await page.locator('#btn-modo-pdv-fullscreen').click();
    await expect(page.locator('#btn-modo-pdv-fullscreen')).toHaveAttribute('aria-pressed', 'true');
    await page.locator('#btn-modo-pdv-fullscreen').click();
    await expect(page.locator('#btn-modo-pdv-fullscreen')).toHaveAttribute('aria-pressed', 'false');
  }
  expect(errors).toEqual([]);
  expect(scenario.actions).toHaveLength(0);
});


test('observation editor can close without saving and order actions stay visible', async ({ page }) => {
  const scenario = await openOperationalScenario(page);
  await showStage(page, 'Salão');
  await page.locator('.orders-card--salon').first().click();
  const dialog = page.locator('.orders-detail-modal');
  await expect(dialog.getByText('Mais opções', { exact: true })).toHaveCount(0);
  await dialog.locator('.kd-items-disclosure > summary').click();
  const edit = dialog.locator('.orders-detail-modal__edit').first();
  await edit.locator('summary').click();
  await expect(edit.locator('textarea')).toBeFocused();
  await edit.getByRole('button', { name: 'Fechar edição' }).click();
  await expect(edit).not.toHaveAttribute('open', '');
  await expect(edit.locator('summary')).toBeFocused();
  expect(scenario.actions).toHaveLength(0);
});

for (const fail of [false, true]) {
  test(`cashier merges tables only after explicit confirmation ${fail ? 'and preserves dialog on failure' : ''}`, async ({ page }) => {
    await openOperationalScenario(page, { statuses: ['preparando'] });
    let writes = 0;
    await page.route('**/comandas/mesclar?**', async route => {
      const url = new URL(route.request().url());
      expect(route.request().method()).toBe('POST');
      expect(url.searchParams.get('mesa_origem_id')).toBe('7');
      expect(url.searchParams.get('mesa_destino_id')).toBe('8');
      writes += 1;
      await route.fulfill({ status: fail ? 409 : 200, json: fail ? { detail: 'Mesa alterada por outro operador.' } : { ok: true } });
    });
    await showStage(page, 'Salão');
    await page.locator('.orders-card--salon').first().click();
    const dialog = page.locator('.orders-detail-modal');
    await dialog.getByRole('button', { name: 'Mesclar mesas', exact: true }).click();
    await dialog.getByRole('radio', { name: /^Mesa 8/ }).click();
    expect(writes).toBe(0);
    await dialog.getByRole('button', { name: 'Confirmar mesclagem', exact: true }).click();
    await expect.poll(() => writes).toBe(1);
    if (fail) {
      await expect(page.getByRole('alert')).toContainText('Mesa alterada por outro operador.');
      await expect(dialog).toBeVisible();
    } else await expect(dialog).toHaveCount(0);
  });
}

test('table conversion opens server-provided options and blocks ambiguous tables', async ({ page }) => {
  await openOperationalScenario(page, { statuses: ['preparando'] });
  let blocked = false;
  await page.route('**/comandas/check-phase7-24/modalidade/opcoes', route => route.fulfill({ json: blocked
    ? { options: [], blocked_reason: 'A mesa possui mais de um pedido.' }
    : { options: ['delivery', 'pickup'], blocked_reason: null, address_snapshot: null } }));
  await showStage(page, 'Salão');
  await page.locator('.orders-card--salon').first().click();
  const detail = page.locator('.orders-detail-modal');
  await expect(detail.getByRole('button', { name: 'Marcar pronto para servir' })).toHaveCount(0);
  await detail.getByRole('button', { name: 'Tipo e endereço' }).click();
  const conversion = page.getByRole('dialog', { name: 'Alterar tipo do pedido' });
  await expect(conversion.getByLabel('Novo tipo do pedido')).toHaveValue('delivery');
  await conversion.getByLabel('Novo tipo do pedido').selectOption('pickup');
  await expect(conversion.locator('#conversion-address-logradouro')).toHaveCount(0);
  await conversion.getByRole('button', { name: 'Cancelar' }).click();
  blocked = true;
  await detail.getByRole('button', { name: 'Tipo e endereço' }).click();
  await expect(conversion.getByRole('alert')).toContainText('mais de um pedido');
  await expect(conversion.getByRole('button', { name: 'Confirmar alteração' })).toHaveCount(0);
});
