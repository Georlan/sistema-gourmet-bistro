import { expect, test } from '@playwright/test';
import { mockCashierBackend, seedCashierSession } from './fixtures/cashier';

test('paid, partially paid and unverified orders have distinct payment messages', async ({ page }) => {
  await mockCashierBackend(page); await seedCashierSession(page);
  const scenarios = [
    { id: 'paid-cash', name: 'Pago no caixa', amount: 40, status: null, method: 'dinheiro' },
    { id: 'paid-online', name: 'Pago online', amount: 40, status: 'approved', method: null },
    { id: 'partial', name: 'Pago parcial', amount: 20, status: 'approved', method: 'cartao_credito' },
    { id: 'unknown', name: 'Conferir saldo', amount: 0, status: 'approved', method: null },
  ];
  const orders = scenarios.map((scenario, index) => ({ id: scenario.id, restaurante_id: 99001, numero_pedido: 200 + index, tipo: 'Delivery', mesa_id: null,
    identificador: scenario.name, fechada: false, valor_pago: scenario.amount, online_payment_status: scenario.status, delivery_status: 'producao',
    delivery_endereco: 'Rua das Flores, 10', delivery_forma_pagamento: scenario.method, criado_em: new Date().toISOString(),
    lancamentos: [{ id: `launch-${scenario.id}`, origem: 'cardapio', status: 'producao' }],
    itens: [{ id: `item-${scenario.id}`, lancamento_id: `launch-${scenario.id}`, produto_id: '101', produto: { nome: 'Prato' }, preco_unit: 40, pago: false, status: 'preparando' }] }));
  await page.route('**/comandas/delivery/ativos', route => route.fulfill({ json: orders }));
  await page.route('**/comandas/detalhes/todos?*', route => route.fulfill({ json: orders }));
  await page.goto('/?view=caixa');
  await expect(page.locator('.orders-board')).toBeVisible();
  const stages = page.getByRole('tablist', { name: 'Etapa dos pedidos' });
  if (await stages.isVisible()) await stages.getByRole('tab', { name: /Digitais/ }).click();
  for (const theme of ['dark', 'light']) {
    if (theme === 'light') await page.locator('#btn-caixa-theme').click();
    for (const scenario of scenarios) {
      await page.locator('.orders-card--digital').filter({ hasText: scenario.name }).click();
      const dialog = page.locator('.orders-detail-modal');
      const payment = dialog.locator('.orders-detail-modal__payment');
      if (scenario.amount === 40) await expect(payment).toContainText('Não cobrar');
      else if (scenario.amount === 20) { await expect(payment).toContainText('Cobrar na entrega'); await expect(payment).toContainText('20,00'); }
      else await expect(payment).toContainText('Conferir pagamento');
      if (scenario.status !== 'approved') await expect(payment).not.toContainText('Pagamento online aprovado');
      await dialog.getByRole('button', { name: 'Fechar detalhes' }).click();
    }
  }
});

test('open delivery detail updates when the courier list arrives', async ({ page }) => {
  await mockCashierBackend(page); await seedCashierSession(page);
  const order = { id: 'courier-delay', restaurante_id: 99001, numero_pedido: 210, tipo: 'Delivery', mesa_id: null,
    identificador: 'Entrega em rota', fechada: false, valor_pago: 0, delivery_status: 'transito', motoboy_id: 7,
    delivery_endereco: 'Rua das Flores, 10', criado_em: new Date().toISOString(),
    lancamentos: [{ id: 'courier-delay-launch', origem: 'cardapio', status: 'producao' }],
    itens: [{ id: 'courier-delay-item', lancamento_id: 'courier-delay-launch', produto_id: '101', produto: { nome: 'Prato' }, preco_unit: 40, pago: false, status: 'preparando' }] };
  await page.route('**/comandas/delivery/ativos', route => route.fulfill({ json: [order] }));
  await page.route('**/comandas/detalhes/todos?*', route => route.fulfill({ json: [order] }));
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/comandas/motoboys/lista', async route => { await gate; await route.fulfill({ json: [{ id: 7, nome: 'Lucas', ativo: true }] }); });
  await page.goto('/?view=caixa');
  await expect(page.locator('.orders-board')).toBeVisible();
  const stages = page.getByRole('tablist', { name: 'Etapa dos pedidos' });
  if (await stages.isVisible()) await stages.getByRole('tab', { name: /Concluir/ }).click();
  await page.locator('.orders-card--closing').filter({ hasText: 'Entrega em rota' }).click();
  const detail = page.locator('.orders-detail-modal');
  await expect(detail).toContainText('Carregando entregador');
  release();
  await expect(detail).toContainText('Lucas');
  await expect(detail).not.toContainText('Entregador não identificado');
});
