import { expect, test } from '@playwright/test';

import { seedCashierSession } from './fixtures/cashier';

for (const viewport of [
  { name: 'mobile', width: 390, height: 844 },
  { name: 'desktop', width: 1366, height: 900 },
]) {
  test(`checkout da mesa exige escolhas explícitas - ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await seedCashierSession(page);

    await page.goto('/?view=caixa');

    const table = page.getByText(/Mesa 1\b/i).first();
    await expect(table).toBeVisible();
    await table.click();

    const receive = page.getByRole('button', { name: /receber|pagamento|fechar/i }).first();
    await expect(receive).toBeVisible();
    await receive.click();

    await expect(page.getByText('Receber Pagamento')).toBeVisible();

    const pix = page.getByRole('button', { name: 'Pix', exact: true });
    const dinheiro = page.getByRole('button', { name: 'Dinheiro', exact: true });
    await expect(pix).not.toHaveClass(/bg-emerald-600/);
    await expect(dinheiro).not.toHaveClass(/bg-emerald-600/);

    await expect(page.getByText(/Pagando \d+ item\(ns\)/)).toHaveCount(0);

    const submit = page.getByRole('button', { name: /Registrar adiantamento|Receber itens prontos/i });
    await submit.click();
    await expect(page.getByText('Escolha a forma de pagamento antes de receber.')).toBeVisible();
  });
}
