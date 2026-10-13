import { expect, test } from '@playwright/test';
import { cashierConfig, mockCashierBackend, seedCashierSession } from './fixtures/cashier';

async function openMenu(page: import('@playwright/test').Page) {
  if ((page.viewportSize()?.width ?? 1366) < 1024) {
    await page.locator('#btn-mobile-caixa-sidebar-open').click();
  }
  return page.getByRole('combobox', { name: 'Pesquisar funções do KÔMA' });
}

test('search opens the content owner by keyboard or touch and closes the mobile menu', async ({ page }) => {
  await mockCashierBackend(page);
  await seedCashierSession(page);
  await page.routeWebSocket(/\/ws\//, socket => socket.onMessage(() => {}));
  await page.goto('/?view=caixa');
  const search = await openMenu(page);
  await search.fill('onde vejo CMV');
  await expect(page.getByRole('option').first()).toContainText('Inteligência do Cardápio');
  await expect(page.getByRole('option').first()).toContainText('CMV estimado');
  await page.screenshot({ path: test.info().outputPath('busca-cmv.png') });
  await search.press('Enter');
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem('koma_active_subtab'))).toBe('gestao_cardapio');
  await expect(page.locator('.cashier-subnav__button', { hasText: 'Inteligência do Cardápio' })).toHaveAttribute('aria-current', 'page');
  if ((page.viewportSize()?.width ?? 1366) < 1024) {
    await expect(page.locator('#mobile-caixa-sidebar')).not.toBeVisible();
  }

  const nextSearch = await openMenu(page);
  await nextSearch.fill('nota fiscal');
  await page.getByRole('option').first().click();
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem('koma_active_subtab'))).toBe('fiscal');
  await expect(page.locator('.cashier-subnav__button', { hasText: /^Fiscal$/ })).toHaveAttribute('aria-current', 'page');
});

test('search respects effective capabilities and can reach loyalty without a same-name main tab', async ({ page }) => {
  await mockCashierBackend(page);
  await seedCashierSession(page);
  await page.routeWebSocket(/\/ws\//, socket => socket.onMessage(() => {}));
  await page.route('**/caixa/configuracoes', route => route.fulfill({ json: {
    ...cashierConfig, plano: 'premium', plano_efetivo: 'premium',
    entitlements: { ...cashierConfig.entitlements, loyalty: true, coupons: true },
  } }));
  await page.goto('/?view=caixa');
  const search = await openMenu(page);
  await search.fill('cashback');
  await expect(page.getByRole('option').first()).toContainText('Programa de Fidelidade');
  await search.press('Enter');
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem('koma_active_subtab'))).toBe('fidelidade');
  await expect(page.locator('.cashier-subnav__button', { hasText: 'Programa de Fidelidade' })).toHaveAttribute('aria-current', 'page');
  await page.screenshot({ path: test.info().outputPath('clientes-organizados.png') });
});
