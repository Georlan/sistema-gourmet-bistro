import { expect, test } from '@playwright/test';
import { mockCashierBackend, seedCashierSession } from './fixtures/cashier';

test('aviso de turno fechado cobre a navegação dos pedidos no celular e mantém leitura', async ({ page }) => {
  await mockCashierBackend(page);
  await page.route('**/caixa/turno/atual', route => route.fulfill({ status: 200, json: null }));
  await page.route('**/caixa/turno-atual/resumo', route => route.fulfill({ status: 200, json: null }));
  await seedCashierSession(page);
  await page.addInitScript(() => localStorage.setItem('koma-theme', 'light'));
  await page.goto('/?view=caixa');
  const notice = page.getByTestId('cashier-shift-blocker');
  await expect(notice).toBeVisible();
  await expect(notice.getByRole('heading', { name: 'Turno de caixa fechado' })).toBeVisible();
  const stages = page.locator('.orders-mobile-stages');
  await expect(stages).toBeVisible();
  const onTop = await stages.evaluate(element => {
    const rect = element.getBoundingClientRect();
    const top = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return Boolean(top?.closest('[data-testid="cashier-shift-blocker"]'));
  });
  expect(onTop).toBe(true);
  await expect(notice.getByRole('button', { name: 'Abrir caixa' })).toBeVisible();
  await notice.getByRole('button', { name: 'Abrir caixa' }).click();
  await expect(page.getByRole('heading', { name: 'Abertura de Caixa' })).toBeVisible();
});
