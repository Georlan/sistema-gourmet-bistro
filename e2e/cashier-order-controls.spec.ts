import { expect, test } from '@playwright/test';
import { openOperationalScenario } from './fixtures/operational';

for (const theme of ['dark', 'light']) {
  test(`search, table identity and online controls remain clear in ${theme}`, async ({ page }) => {
    await page.addInitScript(theme => localStorage.setItem('@koma:theme', theme), theme);
    await openOperationalScenario(page);
    await page.route('**/api/online-orders/control', route => route.fulfill({ json: {
      paused: false, counts: { active: 7 }, level: 'normal', auto_accept: false,
    } }));
    await page.reload();
    await expect(page.locator('.orders-board')).toBeVisible();
    await expect(page.locator('.orders-delivery-total')).toHaveCount(0);
    const search = page.getByRole('searchbox', { name: 'Buscar pedidos' });
    await search.fill('Produto inexistente 9981');
    await expect(page.locator('.orders-card')).toHaveCount(0);
    await page.getByRole('button', { name: 'Limpar busca', exact: true }).click();
    await expect(page.locator('.orders-card').first()).toBeVisible();
    const table = page.locator('.orders-column--closing .orders-card__number.is-table').first();
    await expect(table.locator('.orders-card__table-label')).toHaveText('Mesa');
    await expect(table.locator('strong')).toHaveText('07');
    const pause = page.locator('#online-orders-emergency-trigger');
    if (await pause.isVisible()) {
      // The pause control remains distinguishable and readable in both themes.
      const style = await pause.evaluate(el => ({ color: getComputedStyle(el).color, background: getComputedStyle(el).backgroundColor }));
      expect(style.color).not.toBe(style.background);
      await expect(pause).toContainText('Pausar cardápio online');
    }
    await page.getByRole('button', { name: 'Novos pedidos', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Novos pedidos' }).getByRole('heading', { name: 'Novos pedidos' })).toBeVisible();
  });
}

test('auto acceptance keeps server confirmation and rolls back a refused update', async ({ page }) => {
  await openOperationalScenario(page);
  await expect(page.locator('.orders-board')).toBeVisible();
  let requests: unknown[] = [];
  let fail = false;
  await page.route('**/api/online-orders/auto-accept', async route => {
    requests.push(route.request().postDataJSON());
    await route.fulfill({ status: fail ? 503 : 200, json: fail ? { detail: 'Indisponível no teste' } : { auto_accept: true } });
  });
  const automatic = page.getByRole('checkbox', { name: 'Aceitar pedidos online automaticamente' });
  await page.locator('.orders-auto-accept').click();
  await expect(automatic).toBeChecked();
  await expect(page.locator('.orders-auto-accept__label small')).toHaveText('Ativo');
  fail = true;
  await page.locator('.orders-auto-accept').click();
  await expect(page.getByText('Indisponível no teste', { exact: true })).toBeVisible();
  await expect(automatic).toBeChecked();
  expect(requests).toEqual([{ enabled: true }, { enabled: false }]);
});
