import { expect, test, type Page } from '@playwright/test';

async function mountBoundary(page: Page) {
  await page.clock.install();
  await page.addInitScript(() => {
    sessionStorage.setItem('koma_caixa_token', 'isolated-test-token');
    sessionStorage.setItem('koma_active_operational_portal', 'caixa');
    sessionStorage.setItem('koma_caixa_role', 'caixa');
    sessionStorage.setItem('koma_caixa_id', 'isolated-operator');
    sessionStorage.setItem('koma_caixa_name', 'Operador isolado');
  });
  await page.goto('/e2e/fixtures/tenant-boundary.html');
}

test('active idle session makes zero recurring probes in one minute', async ({ page }) => {
  let probes = 0;
  await page.route('**/produtos/categorias', route => {
    probes += 1;
    return route.fulfill({ json: [] });
  });
  await mountBoundary(page);
  await expect(page.getByLabel('Verificando acesso do estabelecimento')).toHaveCount(0);
  await expect.poll(() => probes).toBe(1);
  for (let tick = 0; tick < 12; tick += 1) {
    await page.clock.runFor(5_000);
    await page.waitForTimeout(50);
  }
  await page.evaluate(() => {
    window.dispatchEvent(new Event('focus'));
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForTimeout(100);
  expect(probes).toBe(1);
});

test('operational suspension blocks the shell and recovery probes stop after reactivation', async ({ page }) => {
  let probes = 0;
  let suspended = false;
  await page.route('**/produtos/categorias', route => {
    probes += 1;
    return route.fulfill(suspended
      ? { status: 403, json: { detail: 'Restaurante suspenso' } }
      : { json: [] });
  });
  await page.route('**/isolated-operation', route => route.fulfill({
    status: 403, json: { detail: 'Restaurante suspenso' },
  }));
  await mountBoundary(page);
  await expect.poll(() => probes).toBe(1);
  suspended = true;
  await page.evaluate(() => fetch('/isolated-operation'));
  await expect(page.getByText('Estabelecimento temporariamente suspenso')).toBeVisible();
  await expect(page.getByText('Operação isolada')).toHaveCount(0);
  await page.clock.runFor(5_000);
  await expect.poll(() => probes).toBe(2);
  suspended = false;
  await page.getByRole('button', { name: 'Verificar acesso' }).click();
  await expect(page.getByText('Operação isolada')).toBeVisible();
  await expect.poll(() => probes).toBe(3);
  for (let tick = 0; tick < 12; tick += 1) {
    await page.clock.runFor(5_000);
    await page.waitForTimeout(50);
  }
  expect(probes).toBe(3);
});

test('unrelated permission 403 does not suspend the tenant', async ({ page }) => {
  await page.route('**/produtos/categorias', route => route.fulfill({ json: [] }));
  await page.route('**/permission-denied', route => route.fulfill({
    status: 403, json: { detail: 'Permissão insuficiente' },
  }));
  await mountBoundary(page);
  await expect(page.getByText('Operação isolada')).toBeVisible();
  await page.evaluate(() => fetch('/permission-denied'));
  await expect(page.getByText('Estabelecimento temporariamente suspenso')).toHaveCount(0);
});
