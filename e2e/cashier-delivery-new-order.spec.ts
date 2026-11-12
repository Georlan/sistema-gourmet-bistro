import { expect, test } from '@playwright/test';
import { mockCashierBackend, seedCashierSession } from './fixtures/cashier';

test('delivery envia endereço simplificado e mostra erro legível preservando carrinho', async ({ page }) => {
  await mockCashierBackend(page);
  await seedCashierSession(page);
  await page.addInitScript(() => {
    sessionStorage.setItem('koma_active_tab', 'operacao');
    sessionStorage.setItem('koma_active_subtab', 'balcao');
  });
  await page.route('**/fidelidade/clientes/lookup?*', route => route.fulfill({
    status: 404, contentType: 'application/json', body: JSON.stringify({ detail: 'Cliente não encontrado' }),
  }));
  let payload: Record<string, any> | undefined;
  await page.route('**/cardapio/modificadores/venda-direta', async route => {
    payload = route.request().postDataJSON();
    await route.fulfill({ status: 422, contentType: 'application/json', body: JSON.stringify({
      detail: [{ loc: ['body', 'address_snapshot', 'logradouro'], type: 'string_too_long' }],
    }) });
  });
  await page.goto('/?view=caixa');
  await page.getByRole('button', { name: 'Adicionar Risoto da casa rapidamente', exact: true }).click();
  if ((page.viewportSize()?.width || 1366) < 1280) {
    await page.getByRole('button', { name: 'Carrinho (1)', exact: true }).click();
  }
  await page.getByRole('button', { name: 'Delivery', exact: true }).click();
  await page.locator('#pdv-customer-phone-input').fill('85999991234');
  await expect(page.getByText('Novo número — o cliente será criado ao lançar o pedido.', { exact: true })).toBeVisible();
  await page.locator('#pdv-customer-name-input').fill('Maria Delivery');
  await page.getByText('Editar entrega', { exact: true }).click();
  await page.locator('#pdv-delivery-address-logradouro').fill('Rua das Flores');
  await page.locator('#pdv-delivery-address-numero').fill('123');
  await page.locator('#pdv-submit-btn').click();
  await expect(page.getByText(/Erro ao registrar venda: Revise os dados do pedido: Logradouro: texto maior/)).toBeVisible();
  expect(payload?.tipo).toBe('Entrega');
  expect(payload?.address_snapshot).toMatchObject({ logradouro: 'Rua das Flores', numero: '123', cidade: '', uf: '' });
  await expect(page.getByText(/\[object Object\]/)).toHaveCount(0);
  if ((page.viewportSize()?.width || 1366) < 1024) {
    await page.getByRole('button', { name: '+ Pedido', exact: true }).click();
  } else {
    await page.getByRole('button', { name: 'Novo pedido', exact: true }).first().click();
  }
  if ((page.viewportSize()?.width || 1366) < 1280) {
    await page.getByRole('button', { name: 'Carrinho (1)', exact: true }).click();
  }
  await expect(page.getByRole('button', { name: 'Remover Risoto da casa', exact: true })).toBeVisible();
  await expect(page.locator('#pdv-customer-name-input')).toHaveValue('Maria Delivery');
});
