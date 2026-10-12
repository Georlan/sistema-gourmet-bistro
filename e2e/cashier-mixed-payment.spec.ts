import { expect, test } from '@playwright/test';
import { API_ORIGIN, openOperationalScenario } from './fixtures/operational';

test('dividir pagamento recebe Pix e dinheiro sem fechar após a primeira parte', async ({ page }) => {
  await openOperationalScenario(page, { subtab: 'mesas', canonicalIdentity: true, statuses: ['entregue', 'entregue'] });
  const payments: { valor: number; metodo: string; idempotency_key: string; item_ids: unknown }[] = [];
  let failNext = false;
  await page.route(`${API_ORIGIN}/caixa/mesas/7/pagar`, async route => {
    const body = route.request().postDataJSON();
    if (failNext) {
      failNext = false;
      return route.fulfill({ status: 503, json: { detail: 'Tente novamente' } });
    }
    payments.push(body);
    await route.fulfill({ json: { valor: body.valor, status: 'aprovado' } });
  });
  const card = page.locator('article[data-table-status="occupied"]');
  await card.getByRole('button', { name: 'Ver comanda', exact: true }).click();
  await page.getByRole('dialog', { name: 'Consumo local · Mesa 07', exact: true }).getByRole('button', { name: 'Receber', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Dividir pagamento' }).check();
  const value = page.getByRole('textbox', { name: /valor/i });
  await expect(value).toHaveValue('');
  await page.getByRole('button', { name: 'Pix', exact: true }).click();
  await value.fill('200,00');
  await page.getByRole('button', { name: /Receber esta parte/ }).click();
  await expect(page.getByText('Informe o valor desta parte, maior que zero e até o saldo restante.', { exact: true })).toBeVisible();
  expect(payments).toHaveLength(0);
  await value.fill('50,00');
  await expect(page.getByText(/Após esta parte, faltam R\$\s*110,00/)).toBeVisible();
  await page.getByRole('button', { name: /Receber esta parte/ }).click();
  await expect(page.getByText(/Saldo restante: R\$\s*110,00/)).toBeVisible();
  await expect(value).toHaveValue('110,00');
  await expect(page.getByRole('button', { name: 'Pix', exact: true })).not.toHaveClass(/bg-emerald-600/);
  expect(payments[0]).toMatchObject({ valor: 50, metodo: 'pix', item_ids: null });
  await page.getByRole('button', { name: 'Dinheiro', exact: true }).click();
  failNext = true;
  await page.getByRole('button', { name: /Receber esta parte/ }).click();
  await expect(page.getByText('Tente novamente', { exact: true })).toBeVisible();
  await expect(page.getByText(/Saldo restante: R\$\s*110,00/)).toBeVisible();
  expect(payments).toHaveLength(1);
  await page.getByRole('button', { name: /Receber esta parte/ }).click();
  await expect(page.getByRole('checkbox', { name: 'Dividir pagamento' })).toHaveCount(0);
  expect(payments).toHaveLength(2);
  expect(payments[1]).toMatchObject({ valor: 110, metodo: 'dinheiro', item_ids: null });
  expect(payments[0].idempotency_key).not.toBe(payments[1].idempotency_key);
});
