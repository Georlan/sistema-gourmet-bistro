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
  if ((page.viewportSize()?.width ?? 1366) < 1280) {
    await page.locator('.cashier-pdv-cart__modality-option').filter({ hasText: 'Delivery' }).click();
  } else {
    await page.getByRole('button', { name: 'Delivery', exact: true }).click();
  }
  await page.locator('#pdv-customer-phone-input').fill('85999991234');
  await expect(page.getByText('Novo número — o cliente será criado ao lançar o pedido.', { exact: true })).toBeVisible();
  await page.locator('#pdv-customer-name-input').fill('Maria Delivery');
  // An empty delivery address is expanded automatically.
  await expect(page.locator('#pdv-delivery-address-logradouro')).toBeVisible();
  await page.locator('#pdv-delivery-address-logradouro').fill('Rua das Flores');
  await page.locator('#pdv-delivery-address-numero').fill('123');
  await page.locator('summary').filter({ hasText: 'Pagamento' }).click();
  await page.getByRole('button', { name: 'Dinheiro', exact: true }).click();
  await page.getByLabel('Troco para (opcional)').fill('100');
  await page.locator('#pdv-submit-btn').click();
  await expect(page.getByText(/Erro ao registrar venda: Revise os dados do pedido: Logradouro: texto maior/)).toBeVisible();
  expect(payload?.delivery_troco_para).toBe(100);
  expect(payload?.delivery_forma_pagamento).toBe('dinheiro');
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
  // The POST carries the persisted order. Hold the subsequent list read until
  // the real card (including its public number) has appeared in the board.
  let releaseSnapshot!: () => void;
  const delayedSnapshot = new Promise<void>(resolve => { releaseSnapshot = resolve; });
  await page.route('**/comandas/delivery/ativos', async route => {
    await delayedSnapshot;
    await route.fulfill({ json: [] });
  });
  await page.route('**/cardapio/modificadores/venda-direta', route => route.fulfill({ json: {
    id: 'confirmed-delivery', numero_pedido: 9876, tipo: 'Entrega', identificador: 'Maria Delivery',
    delivery_status: 'producao', delivery_forma_pagamento: 'dinheiro', delivery_troco_para: 100,
    itens: [{ id: 'risoto', nome: 'Risoto da casa', preco_unit: 42, status: 'preparando' }],
  } }));
  try {
    await page.locator('#pdv-submit-btn').click();
    const digitalTab = page.getByRole('tab', { name: /Entregas/ }).first();
    if (await digitalTab.isVisible()) await digitalTab.click();
    await expect(page.locator('.orders-card--digital').filter({ hasText: '9876' })).toContainText('42,00');
  } finally {
    releaseSnapshot();
  }
});

test('agrupamento por atendimento ignora preferências antigas', async ({ page }) => {
  await mockCashierBackend(page);
  await seedCashierSession(page);
  await page.addInitScript(() => localStorage.setItem('koma_orders_grouping', 'stage'));
  await page.goto('/?view=caixa');
  const board = page.locator('.orders-board');
  await expect(board.locator('.orders-card').first()).toBeAttached();
  for (const name of ['Mesas', 'Retiradas', 'Entregas']) {
    await expect(board.getByRole('heading', { name, exact: true, includeHidden: true })).toHaveCount(1);
  }
  await expect(page.getByRole('combobox', { name: 'Dividir painel de pedidos' })).toHaveCount(0);
});
test('consulta mesas e restaura a divisão sem escrita', async ({page}) => {
  await mockCashierBackend(page);
  await seedCashierSession(page);
  const writes: string[] = [];
  page.on('request', r => {
    if (r.url().includes('/comandas/') && !['GET','OPTIONS'].includes(r.method())) writes.push(r.method());
  });
  await page.goto('/?view=caixa');
  const board = page.locator('.orders-board');
  await expect(board.locator('.orders-card').first()).toBeAttached();
  const filters = page.getByRole('group',{name:'Filtrar pedidos por atendimento'});
  await filters.getByRole('button',{name:/^Mesas/}).click();
  await expect(board.locator('.orders-column')).toHaveCount(1);
  await expect(board.getByRole('heading',{name:'Mesas'})).toBeVisible();
  await expect(board.locator('.orders-column--digital')).toHaveCount(0);
  await filters.getByRole('button',{name:'Todos'}).click();
  await expect(board.locator('.orders-column')).toHaveCount(3);
  await page.reload();
  await expect(page.getByRole('combobox',{name:'Dividir painel de pedidos'})).toHaveCount(0);
  expect(writes).toEqual([]);
});
