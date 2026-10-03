import { expect, test, type Page } from '@playwright/test';
import { cashierConfig, mockCashierBackend, seedCashierSession } from './fixtures/cashier';

async function setup(page: Page, status = 'producao', kitchen = false, legacySuffix = true) {
  await mockCashierBackend(page);
  await seedCashierSession(page);
  await page.addInitScript(({ kitchen }) => {
    sessionStorage.setItem('koma_active_tab', 'operacao');
    sessionStorage.setItem('koma_active_subtab', 'pedidos');
    if (kitchen) sessionStorage.setItem('koma_caixa_role', 'cozinha');
  }, { kitchen });
  const modifiers = [
    { id: 'chicken', nome: 'Frango', preco: 0, grupo_id: 'protein', grupo_nome: 'Proteínas' },
    { id: 'rice', nome: 'Arroz à grega', preco: 0, grupo_id: 'side', grupo_nome: 'Guarnições' },
    { id: 'egg', nome: 'Ovo', preco: 2, grupo_id: 'extras', grupo_nome: 'Adicionais pagos' },
    { id: 'egg', nome: 'Ovo', preco: 2, grupo_id: 'extras', grupo_nome: 'Adicionais pagos' },
  ];
  const check = { id: 'meal-composition', numero_pedido: 24, tipo: 'Retirada', mesa_id: 0,
    identificador: 'Cliente composição', garcom_id: 'caixa-e2e', criada_por: { nome: 'Caixa E2E' },
    delivery_status: status, delivery_forma_pagamento: 'dinheiro', valor_pago: 0, fechada: false,
    criado_em: new Date().toISOString(),
    lancamentos: [{ id: 'meal-launch', origem: 'cardapio', status }],
    itens: [
      { id: 'meal-chicken', produto_id: 'meal-g', produto: { nome: 'Quentinha G' }, preco_unit: 14,
        status: 'preparando', pago: false, lancamento_id: 'meal-launch', cliente_nome: 'Cliente composição',
        observacao: legacySuffix ? 'Sem salada - Opções: Frango, Arroz à grega, 2x Ovo' : 'Sem salada', modificadores: modifiers, composicao_agrupada: true },
      { id: 'meal-beef', produto_id: 'meal-g', produto: { nome: 'Quentinha G' }, preco_unit: 14,
        status: 'preparando', pago: false, lancamento_id: 'meal-launch', cliente_nome: 'Cliente composição',
        observacao: 'Sem salada', modificadores: [{ ...modifiers[0], id: 'beef', nome: 'Costela' }], composicao_agrupada: true },
    ],
  };
  await page.route('**/caixa/configuracoes', route => route.fulfill({ json: {
    ...cashierConfig, operation_profile: 'marmitaria', tipos_pedido_ativos: ['retirada', 'delivery'],
  } }));
  await page.route('**/comandas/detalhes/todos*', route => route.fulfill({ json: [check] }));
  await page.route('**/comandas/delivery/ativos*', route => route.fulfill({ json: [check] }));
  await page.route('**/comandas/delivery/pendentes*', route => route.fulfill({ json: status === 'pendente' ? [check] : [] }));
  await page.goto('/?view=caixa');
}

test('marmitaria shows the same grouped choices in Kanban and details without merging different meals', async ({ page }) => {
  await setup(page, 'producao', false, false);
  const card = page.locator('.orders-card--digital');
  await expect(card).toHaveCount(1);
  await expect(card).toContainText('PROTEÍNAS: Frango');
  await expect(card).toContainText('PROTEÍNAS: Costela');
  await expect(card).toContainText('ADICIONAIS PAGOS: 2x Ovo');
  await expect(card).not.toContainText('Opções:');
  await card.click();
  const details = page.locator('.orders-detail-modal');
  await expect(details.locator('.orders-detail-modal__item')).toHaveCount(2);
  await expect(details).toContainText('GUARNIÇÕES: Arroz à grega');
  await expect(details.getByRole('textbox').first()).toHaveValue('Sem salada');
});

test('new-order notification and acceptance show compact groups and customer note', async ({ page }) => {
  await setup(page, 'pendente');
  await page.getByRole('button', { name: /Aguardando aceite/ }).click();
  const notification = page.locator('.orders-pending-card');
  await expect(notification).toContainText('PROTEÍNAS: Frango');
  await expect(notification).toContainText('PROTEÍNAS: Costela');
  await expect(notification).toContainText('ADICIONAIS PAGOS: 2x Ovo');
  await expect(notification).toContainText('OBS: Sem salada');
  await expect(notification).not.toContainText('Opções:');
});

test('kitchen keeps grouped composition visible independently of the free-text observation', async ({ page }) => {
  await setup(page, 'producao', true);
  const meal = page.locator('#kitchen-card-meal-chicken');
  await expect(meal).toContainText('PROTEÍNAS: Frango');
  await expect(meal).toContainText('GUARNIÇÕES: Arroz à grega');
  await expect(meal).toContainText('ADICIONAIS PAGOS: 2x Ovo');
  await expect(meal).toContainText('OBS: Sem salada');
  await expect(meal).not.toContainText('Opções:');
});
