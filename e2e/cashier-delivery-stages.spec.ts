import { expect, test } from '@playwright/test';
import { mockCashierBackend, seedCashierSession } from './fixtures/cashier';

test('delivery pronto avança à última coluna, despacha e permanece até fechar e pagar', async ({ page }) => {
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
  await page.getByRole('button', { name: /Aguardando aceite/ }).click();
  await page.getByRole('button', { name: '✓ Aceitar', exact: true }).click();
  const digital = page.locator('.orders-column--digital');
  const closing = page.locator('.orders-column--closing');
  const digitalTab = page.getByRole('tab', { name: /^Digitais/ });
  if (await digitalTab.isVisible()) await digitalTab.click();
  await expect(digital.getByRole('button', { name: 'Iniciar preparo', exact: true })).toBeVisible();
  await expect(closing.locator('.orders-card--closing')).toHaveCount(0);
  await digital.getByRole('button', { name: 'Iniciar preparo', exact: true }).click();
  await expect(digital.getByRole('combobox')).toHaveCount(0);
  await expect(digital).toContainText('Opções: Bisteca, Costela, Baião, Arroz, Salada verde');
  await expect(digital).not.toContainText('Cozinha');
  await digital.locator('.orders-card--digital').click();
  await expect(page.locator('.orders-detail-modal').getByRole('combobox', { name: 'Entregador do pedido' })).toHaveCount(0);
  await page.locator('.orders-detail-modal').getByRole('button', { name: 'Fechar detalhes' }).click();
  await digital.getByRole('button', { name: 'Pronto para sair', exact: true }).click();
  await expect(digital.locator('.orders-card--digital')).toHaveCount(0);
  const closingTab = page.getByRole('tab', { name: /^Concluir/ });
  if (await closingTab.isVisible()) await closingTab.click();
  await expect(closing.getByRole('button', { name: 'Saiu para entrega', exact: true })).toBeDisabled();
  await closing.getByRole('combobox', { name: 'Entregador do pedido 87' }).selectOption('7');
  await expect(closing.getByText('R$ 47,00', { exact: true })).toBeVisible();
  await expect(closing).toContainText('Quentinha G');
  await expect(closing).toContainText('Opções: Bisteca, Costela, Baião, Arroz, Salada verde');
  await expect(closing.getByRole('button', { name: 'Saiu para entrega', exact: true })).toBeEnabled();
  await closing.getByRole('button', { name: 'Saiu para entrega', exact: true }).click();
  await expect(closing.locator('.orders-card--closing')).toHaveCount(1);
  await expect(closing).toContainText('EM ROTA');
  await expect(closing.getByRole('button', { name: 'Fechar e pagar', exact: true })).toBeVisible();
  await expect(closing.getByRole('combobox')).toHaveCount(0);
  await expect(closing.getByRole('button', { name: 'Trocar entregador', exact: true })).toHaveCount(0);
  await expect(closing.getByRole('button', { name: 'Saiu para entrega', exact: true })).toHaveCount(0);
  await expect(closing.getByText('R$ 47,00', { exact: true })).toBeVisible();
  await closing.getByRole('button', { name: 'Fechar e pagar', exact: true }).click();
  await expect(page.getByText('CHECKOUT / CAIXA')).toBeVisible();
  await page.getByRole('button', { name: 'Dinheiro', exact: true }).click();
  await page.getByRole('button', { name: /Receber saldo total/i }).click();
  await expect(closing.locator('.orders-card--closing')).toHaveCount(0);
  expect(paid).toBe(true);
  expect(transitions).toEqual(['aceito', 'producao', 'pronto', 'transito', 'finalizado']);
});
