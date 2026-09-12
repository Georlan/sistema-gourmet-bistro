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
  await expect(page.getByText('Recebimento', { exact: true })).toBeVisible();

  const pix = page.getByRole('button', { name: 'Pix', exact: true });
  const dinheiro = page.getByRole('button', { name: 'Dinheiro', exact: true });
  await expect(pix).not.toHaveClass(/bg-emerald-600/);
  await expect(dinheiro).not.toHaveClass(/bg-emerald-600/);
  await expect(page.getByText(/Pagando \d+ item\(ns\)/)).toHaveCount(0);

  // O saldo vem preenchido para reduzir digitação, mas continua editável e
  // não implica seleção de itens nem método financeiro.
  const valueInput = page.getByRole('textbox', { name: 'Valor a lançar' });
  await expect(valueInput).toHaveValue('160,00');

  // Botão principal é explícito e não ambíguo: informa a ação e o valor
  const submitButton = page.locator('button[type="submit"]');
  await expect(submitButton).toHaveText(/Receber saldo total · R\$\s*160,00/);

  // Tentativa de submissão sem selecionar forma de pagamento bloqueia
  await submitButton.click();
  await expect(page.getByText('Escolha a forma de pagamento antes de receber.', { exact: true })).toBeVisible();
  expect(state.actions.filter((action) => /pagar/.test(action.path))).toEqual([]);

  // Selecionar forma de pagamento limpa o erro imediatamente
  await pix.click();
  await expect(pix).toHaveClass(/bg-emerald-600/);
  await expect(page.getByText('Escolha a forma de pagamento antes de receber.', { exact: true })).toHaveCount(0);

  // Alterar valor para parcial atualiza rótulo do botão de forma coerente
  await valueInput.fill('50,00');
  await expect(submitButton).toHaveText(/Receber parcial · R\$\s*50,00/);

  // Restaurar saldo total
  await page.getByRole('button', { name: 'Usar saldo total', exact: true }).click();
  await expect(valueInput).toHaveValue('160,00');
  await expect(submitButton).toHaveText(/Receber saldo total · R\$\s*160,00/);

  // Selecionar item pronto atualiza valor e botão principal
  const itemRow = page.locator('text=Prato da segunda rodada').first();
  await itemRow.click();
  await expect(valueInput).toHaveValue('48,00');
  await expect(submitButton).toHaveText(/Receber itens selecionados · R\$\s*48,00/);

  // Desselecionar/Limpar seleção retorna ao saldo total
  await page.getByRole('button', { name: 'Limpar', exact: true }).click();
  await expect(valueInput).toHaveValue('160,00');
  await expect(submitButton).toHaveText(/Receber saldo total · R\$\s*160,00/);

  // Nenhuma baixa foi efetivada
  expect(state.actions.filter((action) => /pagar/.test(action.path))).toEqual([]);
});
