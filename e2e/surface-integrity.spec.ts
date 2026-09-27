import { expect, test, type Page } from '@playwright/test';
import {
  contractRoutes, legalRoutes, officialHosts, operatorNavigationIds, publicRoutes,
  SURFACE_REGISTRY_VERSION,
} from './surfaceRegistry.v1';
import { mockCashierBackend, seedCashierSession } from './fixtures/cashier';
import type { CashierNavigationGroup } from '../src/components/caixa/navigation/cashierNavigation';

type BrowserErrors = { exceptions: string[]; server: string[]; assets: string[] };

function watchErrors(page: Page): BrowserErrors {
  const errors: BrowserErrors = { exceptions: [], server: [], assets: [] };
  page.on('pageerror', error => errors.exceptions.push(error.message));
  page.on('response', response => {
    const url = response.url();
    if (response.status() >= 500) errors.server.push(`${response.status()} ${url}`);
    if (response.status() === 404 && /\.(js|css|svg|png|webp|woff2?)(\?|$)/.test(url)) {
      errors.assets.push(url);
    }
  });
  return errors;
}

test(`registry v${SURFACE_REGISTRY_VERSION}: legal documents render and navigate`, async ({ page }) => {
  const errors = watchErrors(page);
  for (const path of legalRoutes) {
    const response = await page.goto(path, { waitUntil: 'domcontentloaded' });
    expect(response?.status(), path).toBe(200);
    await expect(page.locator('main h1').first(), path).toBeVisible();
    await expect(page.locator('main'), path).not.toContainText(/página não encontrada|documento não encontrado/i);
    if (path === '/legal') {
      await page.locator('.koma-legal-card').first().click();
    }
    await page.getByRole('link', { name: /Central legal|Voltar para a central legal/ }).last().click();
    await expect(page).toHaveURL(/\/legal$/);
  }
  expect(errors).toEqual({ exceptions: [], server: [], assets: [] });
});

test(`registry v${SURFACE_REGISTRY_VERSION}: contract routes show their selected plan and cycle`, async ({ page }) => {
  const errors = watchErrors(page);
  await page.route('**/api/contracts/payment-methods-v2', route => route.fulfill({ json: {
    credit_card: true, pix: true, account_money: true, publicKey: 'TEST-public',
  } }));
  for (const path of contractRoutes) {
    const response = await page.goto(path, { waitUntil: 'domcontentloaded' });
    expect(response?.status(), path).toBe(200);
    const plan = path.split('/')[2].split('?')[0];
    const annual = path.includes('anual');
    await expect(page.locator('main').first(), path).toBeVisible();
    await expect(page.getByRole('radio', { name: annual ? /^Anual/ : /^Mensal/ }), path).toBeChecked();
    await expect(page.locator('main'), path).toContainText(new RegExp(plan, 'i'));
    const alternate = page.getByRole('radio', { name: annual ? /^Mensal/ : /^Anual/ });
    await alternate.click();
    await expect(alternate).toBeChecked();
  }
  expect(errors.exceptions).toEqual([]);
  expect(errors.assets).toEqual([]);
});

test(`registry v${SURFACE_REGISTRY_VERSION}: standalone public routes render`, async ({ page }) => {
  const errors = watchErrors(page);
  for (const route of publicRoutes) {
    const response = await page.goto(route.path, { waitUntil: 'domcontentloaded' });
    expect(response?.status(), route.id).toBe(200);
    await expect(page.locator('body'), route.id).toContainText(/\S{3,}/);
    await expect(page.locator('body'), route.id).not.toContainText(/página não encontrada|application error/i);
  }
  expect(errors.exceptions).toEqual([]);
  expect(errors.assets).toEqual([]);
});

test('official hosts render from the public internet', async ({ page }) => {
  test.skip(process.env.KOMA_SURFACE_LIVE !== '1', 'Set KOMA_SURFACE_LIVE=1 for read-only production smoke.');
  const errors = watchErrors(page);
  for (const surface of officialHosts) {
    const response = await page.goto(surface.url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    expect(response?.status(), surface.id).toBe(200);
    await expect(page.locator('body'), surface.id).toContainText(/\S{3,}/);
    await expect(page.locator('body'), surface.id).not.toContainText(/página não encontrada|application error/i);
  }
  expect(errors.exceptions).toEqual([]);
  expect(errors.server).toEqual([]);
  expect(errors.assets).toEqual([]);
});

test('official deep links render from the public internet', async ({ page }) => {
  test.skip(process.env.KOMA_SURFACE_LIVE !== '1', 'Set KOMA_SURFACE_LIVE=1 for read-only production smoke.');
  const errors = watchErrors(page);
  const urls = [
    ...publicRoutes.map(route => new URL(route.path, 'https://app.komafood.com.br').href),
    ...legalRoutes.map(path => new URL(path, 'https://komafood.com.br').href),
    ...contractRoutes.map(path => new URL(path, 'https://komafood.com.br').href),
  ];
  for (const url of urls) {
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    expect(response?.status(), url).toBe(200);
    await expect(page.locator('body'), url).toContainText(/\S{3,}/);
    await expect(page.locator('body'), url).not.toContainText(/página não encontrada|application error/i);
  }
  expect(errors.exceptions).toEqual([]);
  expect(errors.server).toEqual([]);
  expect(errors.assets).toEqual([]);
});

test('official operational navigation opens every registered screen', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-1366', 'Desktop sidebar owns the expanded child navigation.');
  test.setTimeout(120_000);
  const errors = watchErrors(page);
  await mockCashierBackend(page);
  await page.routeWebSocket(/\/ws\//, socket => socket.onMessage(() => {}));
  await seedCashierSession(page);
  await page.goto('/?view=caixa');
  const sidebar = page.locator('.cashier-sidebar:visible');
  await expect(sidebar).toBeVisible();
  const entries = await page.evaluate(async () => {
    const modulePath = '/src/components/caixa/navigation/cashierNavigation.ts';
    const { CASHIER_SIDEBAR_GROUPS } = await import(/* @vite-ignore */ modulePath) as {
      CASHIER_SIDEBAR_GROUPS: readonly CashierNavigationGroup[];
    };
    return CASHIER_SIDEBAR_GROUPS.flatMap(group => group.items.flatMap(item => [
      { id: item.id, label: item.label, parent: item.label, child: false },
      ...(item.children || []).map(child => ({ id: child.id, label: child.label, parent: item.label, child: true })),
    ]));
  });

  for (const id of operatorNavigationIds) {
    const entry = entries.find(item => item.id === id);
    expect(entry, `Missing registered navigation ${id}`).toBeDefined();
    if (id === 'vendas_novo_pedido') continue;
    if (entry!.child) {
      const child = sidebar.locator('.cashier-nav-child').filter({ hasText: entry!.label });
      if (!(await child.isVisible())) {
        await sidebar.locator(`.cashier-nav-item[title="${entry!.parent}"]`).click();
      }
      await child.click();
      await expect(child, id).toHaveAttribute('aria-current', 'page');
    } else {
      await sidebar.locator(`.cashier-nav-item[title="${entry!.parent}"]`).click();
    }
    await expect(page.locator('main').first(), id).toBeVisible();
  }
  await sidebar.locator('.cashier-nav-item[title="Vendas"]').click();
  await sidebar.locator('.cashier-nav-child').filter({ hasText: 'Novo pedido' }).click();
  await expect(page.getByRole('region', { name: 'Novo pedido rápido e simples' })).toBeVisible();
  expect(errors.exceptions).toEqual([]);
  expect(errors.assets).toEqual([]);
});
