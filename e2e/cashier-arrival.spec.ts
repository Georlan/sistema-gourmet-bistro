import { expect, test } from '@playwright/test';
import { mockCashierBackend, seedCashierSession } from './fixtures/cashier';

test('pedido que avança destaca a coluna de destino', async ({ page }) => {
  await mockCashierBackend(page);
  await seedCashierSession(page);
  let currentStatus = 'pendente';
  let courier: number | null = null;
  let paid = false;
  const transitions: string[] = [];
  const check = () => ({
    id: 'delivery-stages', restaurante_id: 99001, numero_pedido: 87,
    tipo: 'Delivery', identificador: 'Cliente entrega', fechada: currentStatus === 'finalizado',
    garcom_id: 'caixa-e2e', valor_pago: paid ? 47 : 0, delivery_status: currentStatus,
    delivery_taxa: 5, delivery_endereco: 'Rua de teste, 123',
    delivery_telefone: '85999999999', delivery_forma_pagamento: 'dinheiro',
    motoboy_id: courier, criado_em: new Date().toISOString(),
    lancamentos: [{ id: 'launch-stages', origem: 'cardapio', status: currentStatus }],
    itens: [{ id: 'item-stages', produto_id: '101', produto: { nome: 'Quentinha G' }, observacao: 'Opções: Bisteca, Costela, Baião, Arroz, Salada verde',
      preco_unit: 42, pago: paid, status: currentStatus === 'pronto' || currentStatus === 'transito' ? 'pronto' : 'preparando', lancamento_id: 'launch-stages' }],
  });
  await page.route('**/comandas/delivery/ativos', route => route.fulfill({ json: currentStatus === 'finalizado' ? [] : [check()] }));
  await page.route('**/comandas/delivery/pendentes', route => route.fulfill({ json: currentStatus === 'pendente' ? [check()] : [] }));
  await page.route('**/comandas/detalhes/todos?*', route => route.fulfill({ json: currentStatus === 'finalizado' ? [] : [check()] }));
  await page.route('**/comandas/motoboys/lista', route => route.fulfill({ json: [{ id: 7, nome: 'Entregador teste', ativo: true }] }));
  await page.route('**/comandas/delivery-stages/delivery/status?*', async route => {
    currentStatus = new URL(route.request().url()).searchParams.get('status_novo')!;
    transitions.push(currentStatus);
    await route.fulfill({ json: check() });
  });
  await page.route('**/comandas/delivery-stages/delivery/entregador', async route => {
    courier = route.request().postDataJSON().motoboy_id;
    const { itens, lancamentos, ...header } = check();
    await route.fulfill({ json: header });
  });
  await page.route('**/comandas/delivery-stages/delivery/despachar', async route => {
    courier = route.request().postDataJSON().motoboy_id;
    expect(courier).toBe(7);
    expect(currentStatus).toBe('pronto');
    currentStatus = 'transito';
    transitions.push(currentStatus);
    const { itens, lancamentos, ...header } = check();
    await route.fulfill({ json: header });
  });
  await page.route('**/comandas/delivery-stages/fechar', async route => {
    expect(paid).toBe(true);
    currentStatus = 'finalizado';
    transitions.push(currentStatus);
    await route.fulfill({ json: check() });
  });
  await page.route('**/caixa/comandas/delivery-stages/pagar', async route => {
    expect(currentStatus).toBe('transito');
    expect(route.request().postDataJSON().valor).toBe(47);
    paid = true;
    await route.fulfill({ json: check() });
  });
  await page.goto('/?view=caixa');
  await page.getByRole('button', { name: /Novos pedidos/ }).click();
  await expect(page.locator('.orders-pending-card')).toContainText('Opções: Bisteca, Costela, Baião, Arroz, Salada verde');
  await page.getByRole('button', { name: 'Aceitar', exact: true }).click();
  const digital = page.locator('.orders-column--digital');
  const closing = page.locator('.orders-column--closing');
  const digitalTab = page.getByRole('tab', { name: /^Digitais/ });
  if (await digitalTab.isVisible()) await digitalTab.click();
  await expect(digital.getByRole('button', { name: 'Marcar como pronto', exact: true })).toBeVisible();
  await expect(closing.locator('.orders-card--closing')).toHaveCount(0);
  await expect(digital.getByRole('combobox')).toHaveCount(0);
  await expect(digital).toContainText('Opções: Bisteca, Costela, Baião, Arroz, Salada verde');
  await expect(digital).not.toContainText('Cozinha');
  await digital.locator('.orders-card--digital').click();
  await expect(page.locator('.orders-detail-modal').getByRole('combobox', { name: 'Entregador do pedido' })).toHaveCount(0);
  await page.locator('.orders-detail-modal').getByRole('button', { name: 'Fechar detalhes' }).click();
  await digital.getByRole('button', { name: 'Marcar como pronto', exact: true }).click();
  await expect(digital.locator('.orders-card--digital')).toHaveCount(0);
  await expect(closing).toHaveClass(/orders-column--arrived/);
  const closingTab = page.getByRole('tab', { name: /^Concluir/ });
  if (await closingTab.isVisible()) await closingTab.click();
  await expect(closing.locator('.orders-card--arrived')).toHaveCount(1);
  await expect(closing).toContainText('Cliente entrega');
});

test('pedidos digitais mais recentes aparecem primeiro', async ({ page }) => {
  await mockCashierBackend(page);
  await seedCashierSession(page);
  const check = (id: string, name: string, date: string) => ({
    id, restaurante_id: 99001, numero_pedido: Number(id), tipo: 'Retirada', identificador: name,
    fechada: false, valor_pago: 0, delivery_status: 'producao', criado_em: date,
    lancamentos: [{ id: `l-${id}`, origem: 'cardapio', status: 'producao' }],
    itens: [{ id: `i-${id}`, produto_id: '101', produto: { nome: 'Suco' }, preco_unit: 10, pago: false, status: 'preparando', lancamento_id: `l-${id}` }],
  });
  const orders = [check('1', 'Pedido antigo', '2026-01-01T12:00:00Z'), check('2', 'Pedido novo', '2026-01-02T12:00:00Z')];
  await page.route('**/comandas/delivery/ativos', route => route.fulfill({ json: orders }));
  await page.route('**/comandas/detalhes/todos?*', route => route.fulfill({ json: orders }));
  await page.goto('/?view=caixa');
  const tab = page.getByRole('tab', { name: /^Digitais/ });
  if (await tab.isVisible()) await tab.click();
  const cards = page.locator('.orders-column--digital .orders-card--digital');
  await expect(cards).toHaveCount(2);
  await expect(cards.nth(0)).toContainText('Pedido novo');
  await expect(cards.nth(1)).toContainText('Pedido antigo');
});

test('novos pedidos mostram identificação e pagamento sem repetir modalidade e fecham com Escape', async ({ page }) => {
  await mockCashierBackend(page);
  await seedCashierSession(page);
  const order = { id:'pending-review', restaurante_id:99001, numero_pedido:887, tipo:'Delivery', identificador:'Cliente teste', fechada:false,
    valor_pago:0, delivery_status:'pendente', delivery_telefone:'85999990000', delivery_endereco:'Rua Teste, 10', delivery_forma_pagamento:'dinheiro', criado_em:new Date().toISOString(),
    lancamentos:[{id:'pending-launch',origem:'cardapio'}], itens:[{id:'pending-item',produto_id:'101',preco_unit:25,status:'preparando',pago:false,lancamento_id:'pending-launch',produto:{nome:'Suco teste'}}] };
  await page.route('**/comandas/delivery/pendentes', route => route.fulfill({json:[order]}));
  await page.goto('/?view=caixa');
  await page.getByRole('button',{name:/Novos pedidos/}).click();
  const drawer = page.getByRole('dialog',{name:'Novos pedidos'});
  await expect(drawer).toContainText('Cliente teste');
  await expect(drawer.getByLabel('Pagamento do pedido')).toContainText('Dinheiro');
  await expect(drawer.getByRole('button',{name:'Aceitar',exact:true})).toBeVisible();
  await expect(drawer.getByText('Delivery',{exact:true})).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);
});
