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
