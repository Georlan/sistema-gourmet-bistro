import { expect, test } from '@playwright/test';

import { openOperationalScenario } from './fixtures/operational';

test('checkout da mesa exige itens e método explícitos', async ({ page }) => {
  const state = await openOperationalScenario(page, {
    subtab: 'mesas',
    canonicalIdentity: true,
    statuses: ['entregue', 'entregue'],
  });

  const card = page.locator('article[data-table-status="occupied"]');
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: 'Ver comanda', exact: true }).click();

  const details = page.getByRole('dialog', { name: 'Mesa 7', exact: true });
  await details.getByRole('button', { name: 'Receber', exact: true }).click();
  await expect(details).toBeHidden();
  await expect(page.getByText('Receber Pagamento', { exact: true })).toBeVisible();

  const pix = page.getByRole('button', { name: 'Pix', exact: true });
  const dinheiro = page.getByRole('button', { name: 'Dinheiro', exact: true });
  await expect(pix).not.toHaveClass(/bg-emerald-600/);
  await expect(dinheiro).not.toHaveClass(/bg-emerald-600/);
  await expect(page.getByText(/Pagando \d+ item\(ns\)/)).toHaveCount(0);

  // O saldo pode vir preenchido para reduzir digitação, mas continua editável e
  // não implica seleção de itens nem método financeiro.
  await expect(page.getByRole('textbox', { name: 'Digite qualquer valor para abater do saldo.' })).toHaveValue('160,00');

  await page.getByRole('button', { name: 'Registrar adiantamento', exact: true }).click();
  await expect(page.getByText('Escolha a forma de pagamento antes de receber.', { exact: true })).toBeVisible();
  expect(state.actions.filter((action) => /pagar/.test(action.path))).toEqual([]);
});
