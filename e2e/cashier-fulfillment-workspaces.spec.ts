import { expect, Page, test } from '@playwright/test';

const API_ORIGIN = 'http://127.0.0.1:8000';
const now = new Date().toISOString();

const cashierConfig = {
  taxa_servico_ativa: true,
  taxa_servico_padrao: 10,
  unificar_vias_delivery: false,
  perm_garcom_delivery: true,
  perm_garcom_editar: true,
  perm_garcom_taxas: true,
  perm_garcom_cancelar: true,
  perm_garcom_status: true,
  perm_garcom_abrir_vazia: true,
  perm_garcom_print: true,
  perm_garcom_fechar: true,
  perm_garcom_desconto: true,
  perm_garcom_acrescimo: true,
  perm_garcom_pessoas: true,
  perm_garcom_transferir_mesa: true,
  perm_garcom_transferir_item: true,
  perm_garcom_chamar: true,
  perm_garcom_ociosas: true,
};

function makeOrder(
  id: string,
  numero: number,
  tipo: 'Retirada' | 'Delivery',
  itemValue: number,
  extra: Record<string, unknown> = {},
) {
  return {
    id,
    restaurante_id: 99001,
    mesa_id: null,
    garcom_id: 'caixa-e2e',
    tipo,
    identificador: tipo === 'Retirada' ? 'Ana Retirada' : 'Bruno Delivery',
    numero_pedido: numero,
    fechada: false,
    valor_pago: 0,
    criado_em: now,
    delivery_status: 'pendente',
    delivery_telefone: tipo === 'Retirada' ? '85999990001' : '85999990002',
    delivery_endereco: tipo === 'Delivery' ? 'Rua das Flores, 123' : null,
    delivery_taxa: tipo === 'Delivery' ? 5 : 0,
    delivery_forma_pagamento: 'dinheiro',
    delivery_troco_para: 100,
    motoboy_id: null,
    lancamentos: [{ id: `launch-${id}`, origem: 'cardapio', timestamp: now }],
    itens: [{
      id: `item-${id}`,
      produto_id: tipo === 'Retirada' ? '101' : '102',
      preco_unit: itemValue,
      observacao: '',
      cliente_nome: tipo === 'Retirada' ? 'Ana Retirada' : 'Bruno Delivery',
      status: 'preparando',
      pago: false,
      produto: {
        id: tipo === 'Retirada' ? '101' : '102',
        nome: tipo === 'Retirada' ? 'Pizza Retirada' : 'Pizza Delivery',
        preco: itemValue,
        ativo: true,
      },
    }],
    ...extra,
  };
}

async function seedCashierSession(page: Page, subTab = 'retiradas') {
  await page.addInitScript((initialSubTab) => {
    localStorage.setItem('koma_caixa_token', 'playwright-e2e-token');
    localStorage.setItem('koma_caixa_id', 'caixa-e2e');
    localStorage.setItem('koma_caixa_name', 'Caixa E2E');
    localStorage.setItem('koma_caixa_role', 'caixa');
    localStorage.setItem('token', 'playwright-e2e-token');
    sessionStorage.setItem('koma_active_tab', 'operacao');
    sessionStorage.setItem('koma_active_subtab', initialSubTab);
  }, subTab);
}

async function expectNoHorizontalOverflow(page: Page) {
  const sizes = await page.evaluate(() => ({
    viewport: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    bodyWidth: document.body.scrollWidth,
  }));
  expect(sizes.documentWidth).toBeLessThanOrEqual(sizes.viewport + 1);
  expect(sizes.bodyWidth).toBeLessThanOrEqual(sizes.viewport + 1);
}

async function mockFulfillmentBackend(
  page: Page,
  initial: { pickupStatus?: string; deliveryStatus?: string } = {},
) {
  let pickup = makeOrder('pickup-workspace-e2e', 5001, 'Retirada', 48, {
    delivery_status: initial.pickupStatus || 'pendente',
  });
  let delivery = makeOrder('delivery-workspace-e2e', 5002, 'Delivery', 55, {
    delivery_status: initial.deliveryStatus || 'pendente',
  });
  let acceptCalls = 0;
  let dispatchCalls = 0;
  let assignmentCalls = 0;
  let reassignmentCalls = 0;
  let conversionCalls = 0;
  let failActiveReads = false;

  const activeOrders = () => [pickup, delivery].filter((order) =>
    !order.fechada && !['finalizado', 'recusado'].includes(String(order.delivery_status)),
  );

  await page.route(`${API_ORIGIN}/**`, async route => {
    const request = route.request();
    const url = new URL(request.url());
    const { pathname } = url;

    if (pathname === '/comandas/delivery/ativos') {
      if (failActiveReads) {
        await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ detail: 'offline' }) });
        return;
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(activeOrders()) });
      return;
    }

    if (pathname === '/comandas/detalhes/todos') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(activeOrders()) });
      return;
    }

    if (pathname === '/comandas/delivery/retiradas/concluidas-recentes') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
      return;
    }

    if (pathname === '/comandas/delivery/entregas/concluidas-recentes') {
      const completed = makeOrder('delivery-completed-e2e', 4999, 'Delivery', 40, {
        fechada: true,
        fechado_em: now,
        delivery_status: 'finalizado',
        valor_pago: 45,
        motoboy_id: 7,
        identificador: 'Cliente Entregue',
      });
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([completed]) });
      return;
    }

    if (pathname.endsWith('/delivery/converter-retirada') && request.method() === 'POST') {
      conversionCalls += 1;
      const body = request.postDataJSON() as { motivo?: string };
      if (!String(body.motivo || '').trim()) {
        await route.fulfill({ status: 422, contentType: 'application/json', body: JSON.stringify({ detail: 'Motivo obrigatório' }) });
        return;
      }
      delivery = {
        ...delivery,
        tipo: 'Retirada',
        delivery_taxa: 0,
        motoboy_id: null,
      };
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(delivery) });
      return;
    }

    if (pathname.endsWith('/delivery/status') && request.method() === 'PUT') {
      const id = pathname.split('/')[2];
      const next = url.searchParams.get('status_novo') || 'pendente';
      if (next === 'producao') acceptCalls += 1;
      if (id === pickup.id) pickup = { ...pickup, delivery_status: next };
      if (id === delivery.id) delivery = { ...delivery, delivery_status: next };
      const updated = id === pickup.id ? pickup : delivery;
      await new Promise(resolve => setTimeout(resolve, 80));
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(updated) });
      return;
    }

    if (pathname.endsWith('/delivery/entregador/reassign') && request.method() === 'POST') {
      reassignmentCalls += 1;
      const body = request.postDataJSON() as { motoboy_id?: number | null; motivo?: string };
      if (!body.motoboy_id || !String(body.motivo || '').trim()) {
        await route.fulfill({ status: 422, contentType: 'application/json', body: JSON.stringify({ detail: 'Motivo obrigatório' }) });
        return;
      }
      delivery = { ...delivery, delivery_status: 'transito', motoboy_id: body.motoboy_id };
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(delivery) });
      return;
    }

    if (pathname.endsWith('/delivery/entregador') && request.method() === 'PUT') {
      assignmentCalls += 1;
      const body = request.postDataJSON() as { motoboy_id?: number | null };
      delivery = { ...delivery, motoboy_id: body.motoboy_id ?? null };
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(delivery) });
      return;
    }

    if (pathname.endsWith('/delivery/despachar') && request.method() === 'POST') {
      dispatchCalls += 1;
      const body = request.postDataJSON() as { motoboy_id?: number | null };
      delivery = { ...delivery, delivery_status: 'transito', motoboy_id: body.motoboy_id ?? 7 };
      await new Promise(resolve => setTimeout(resolve, 80));
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(delivery) });
      return;
    }

    if (pathname === '/comandas/motoboys/lista') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          { id: 7, nome: 'Pedro Entregador', telefone: '85999990007', ativo: true },
          { id: 8, nome: 'Lia Entregas', telefone: '85999990008', ativo: true },
        ]),
      });
      return;
    }

    if (pathname === '/mesas/') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
      return;
    }

    if (pathname === '/produtos/catalogo') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          categorias: [{ id: 'cat-pizza', nome: 'Pizzas', destino_impressao: 'COZINHA' }],
          produtos: [
            { id: '101', nome: 'Pizza Retirada', preco: 48, categoria_id: 'cat-pizza', ativo: true },
            { id: '102', nome: 'Pizza Delivery', preco: 55, categoria_id: 'cat-pizza', ativo: true },
          ],
        }),
      });
      return;
    }

    if (pathname === '/caixa/configuracoes') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(cashierConfig) });
      return;
    }

    if (pathname === '/caixa/turno/atual') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 501,
          aberto_por_id: 'caixa-e2e',
          aberto_em: now,
          saldo_inicial: 100,
          status: 'aberto',
          movimentacoes: [],
          pagamentos: [],
        }),
      });
      return;
    }

    if (pathname === '/caixa/turno-atual/resumo') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          turno_id: 501,
          status: 'aberto',
          operador_id: 'caixa-e2e',
          operador_nome: 'Caixa E2E',
          aberto_em: now,
          tempo_aberto_minutos: 5,
          saldo_inicial: 100,
          total_vendas: 0,
          total_dinheiro: 0,
          total_pix: 0,
          total_cartao: 0,
          total_sangrias: 0,
          total_suprimentos: 0,
          saldo_esperado_dinheiro: 100,
          total_pedidos_pagos: 0,
          atividades_recentes: [],
        }),
      });
      return;
    }

    if (
      pathname === '/caixa/pagamentos/pendentes'
      || pathname === '/auth/usuarios'
      || pathname === '/chat/caixa/conversas'
    ) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
      return;
    }

    if (pathname === '/auth/smartpos/caixa/operacao') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
      return;
    }

    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });

  return {
    getAcceptCalls: () => acceptCalls,
    getDispatchCalls: () => dispatchCalls,
    getAssignmentCalls: () => assignmentCalls,
    getReassignmentCalls: () => reassignmentCalls,
    getConversionCalls: () => conversionCalls,
    setFailActiveReads: (value: boolean) => { failActiveReads = value; },
  };
}

test('Retiradas e Entregas permitem completar o trabalho normal sem voltar ao Kanban', async ({ page }) => {
  await seedCashierSession(page);
  const state = await mockFulfillmentBackend(page);
  await page.goto('/?view=caixa');

  const pickups = page.locator('#cashier-pickups-workspace');
  await expect(pickups).toBeVisible();
  await expect(pickups).toContainText('Aguardando aceite');
  await expect(pickups).toContainText(/A cobrar R\$\s*48,00/);
  await expect(pickups).toContainText('Dinheiro');
  await expect(pickups).toContainText(/Troco para R\$\s*100,00/);
  await expect(pickups.getByRole('button', { name: 'Recusar' })).toBeVisible();

  const acceptPickup = pickups.getByRole('button', { name: 'Aceitar pedido' });
  await acceptPickup.evaluate((element) => {
    (element as HTMLButtonElement).click();
    (element as HTMLButtonElement).click();
  });
  await expect.poll(state.getAcceptCalls).toBe(1);
  await expect(pickups).toContainText('Em preparo');

  await pickups.getByRole('button', { name: 'Marcar pronto para retirada' }).click();
  await expect(pickups).toContainText('Pronto para retirada');
  const pickupCheckout = pickups.getByRole('button', { name: 'Receber e concluir retirada' });
  await expect(pickupCheckout).toBeVisible();
  await pickupCheckout.click();
  await expect(page.getByText('CHECKOUT / CAIXA')).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await page.reload();
  const deliveriesTab = page.locator('.cashier-subnav__button', { hasText: 'Entregas' });
  await deliveriesTab.click();

  const deliveries = page.locator('#cashier-deliveries-workspace');
  await expect(deliveries).toBeVisible();
  await expect(deliveries).toContainText('Aguardando aceite');
  await expect(deliveries).toContainText(/A cobrar R\$\s*60,00/);
  await expect(deliveries.getByRole('button', { name: 'Recusar' })).toBeVisible();

  const acceptDelivery = deliveries.getByRole('button', { name: 'Aceitar pedido' });
  await acceptDelivery.evaluate((element) => {
    (element as HTMLButtonElement).click();
    (element as HTMLButtonElement).click();
  });
  await expect.poll(state.getAcceptCalls).toBe(2);
  await expect(deliveries).toContainText('Em preparo');

  const courierSelect = deliveries.getByRole('combobox', { name: /Entregador do pedido 5002/i });
  await courierSelect.selectOption('7');
  await expect.poll(state.getAssignmentCalls).toBe(1);
  await deliveries.getByRole('button', { name: 'Marcar pronto para sair' }).click();
  await expect(deliveries).toContainText('Pronto');

  const dispatch = deliveries.getByRole('button', { name: 'Saiu para entrega' });
  await dispatch.evaluate((element) => {
    (element as HTMLButtonElement).click();
    (element as HTMLButtonElement).click();
  });
  await expect.poll(state.getDispatchCalls).toBe(1);
  await expect(deliveries).toContainText('Em rota');
  await expect(deliveries).toContainText('Pedro Entregador');
  await expect(deliveries).toContainText('Pedido #4999');

  state.setFailActiveReads(true);
  await page.evaluate(() => window.dispatchEvent(new Event('koma_orders_updated')));
  await expect(deliveries).toContainText('Mostrando o último estado conhecido');
  await expect(deliveries).toContainText('Em rota');
  state.setFailActiveReads(false);

  const deliveryCheckout = deliveries.getByRole('button', { name: 'Receber e marcar entregue' });
  await expect(deliveryCheckout).toBeVisible();
  await deliveryCheckout.click();
  await expect(page.getByText('CHECKOUT / CAIXA')).toBeVisible();
  await expectNoHorizontalOverflow(page);
});


test('Pedidos permite atribuir entregador no card e despachar sem abrir detalhes', async ({ page }) => {
  await seedCashierSession(page, 'pedidos');
  const state = await mockFulfillmentBackend(page, {
    pickupStatus: 'finalizado',
    deliveryStatus: 'producao',
  });
  await page.goto('/?view=caixa');

  await page.locator('.orders-mobile-stages__button').filter({ hasText: 'Balcão' }).evaluate((element) => {
    (element as HTMLButtonElement).click();
  });
  const productionCard = page.locator('.orders-card--digital').filter({ hasText: 'Bruno Delivery' });
  await expect(productionCard).toBeVisible();

  const courierSelect = productionCard.getByRole('combobox', { name: /Entregador do pedido 5002/i });
  await expect(courierSelect).toBeVisible();
  await courierSelect.selectOption('7');
  await expect.poll(state.getAssignmentCalls).toBe(1);
  await expect(courierSelect).toHaveValue('7');

  await productionCard.getByRole('button', { name: /Pronto para sair/i }).click();

  await page.locator('.orders-mobile-stages__button').filter({ hasText: 'Concluir' }).evaluate((element) => {
    (element as HTMLButtonElement).click();
  });
  const readyCard = page.locator('.orders-card--closing').filter({ hasText: 'Bruno Delivery' });
  await expect(readyCard).toBeVisible();
  await expect(readyCard).toContainText('PRONTO PARA ENVIO');
  const readyCourierSelect = readyCard.getByRole('combobox', { name: /Entregador do pedido 5002/i });
  await expect(readyCourierSelect).toHaveValue('7');

  const dispatch = readyCard.getByRole('button', { name: 'Saiu para entrega' });
  await expect(dispatch).toBeEnabled();
  await dispatch.click();
  await expect.poll(state.getDispatchCalls).toBe(1);

  const inRouteCard = page.locator('.orders-card--closing').filter({ hasText: 'Bruno Delivery' });
  await expect(inRouteCard).toContainText('EM ROTA');
  await expect(inRouteCard).toContainText('Pedro Entregador');
  await expect(inRouteCard.getByRole('combobox', { name: /Entregador do pedido 5002/i })).toHaveCount(0);

  await inRouteCard.getByRole('button', { name: 'Trocar entregador' }).click();
  const reassignmentDialog = page.getByRole('dialog', { name: 'Trocar entregador' });
  await expect(reassignmentDialog).toBeVisible();
  await expect(reassignmentDialog).toContainText('Pedro Entregador');
  await reassignmentDialog.getByRole('combobox', { name: 'Novo entregador' }).selectOption('8');
  await reassignmentDialog.getByRole('textbox', { name: 'Motivo da troca de entregador' }).fill('Entregador selecionado por engano');
  await reassignmentDialog.getByRole('button', { name: 'Confirmar troca' }).click();
  await expect.poll(state.getReassignmentCalls).toBe(1);
  await expect(reassignmentDialog).toBeHidden();
  await expect(inRouteCard).toContainText('Lia Entregas');
  await expect(inRouteCard).toContainText('EM ROTA');
  await expectNoHorizontalOverflow(page);
});


test('delivery alterado para retirada sai de Entregas e aparece em Retiradas sem refresh', async ({ page }) => {
  await seedCashierSession(page, 'entregadores');
  const state = await mockFulfillmentBackend(page, {
    pickupStatus: 'finalizado',
    deliveryStatus: 'producao',
  });
  await page.goto('/?view=caixa');

  const deliveries = page.locator('#cashier-deliveries-workspace');
  await expect(deliveries).toBeVisible();
  await expect(deliveries).toContainText('Bruno Delivery');

  await deliveries.getByRole('button', { name: 'Alterar para retirada' }).click();
  const dialog = page.getByRole('dialog', { name: 'Alterar para retirada' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('textbox', { name: 'Motivo da alteração para retirada' })
    .fill('Cliente avisou que passará para buscar');
  await dialog.getByRole('button', { name: 'Confirmar retirada' }).click();

  await expect.poll(state.getConversionCalls).toBe(1);
  await expect(dialog).toBeHidden();
  await expect(deliveries).not.toContainText('Bruno Delivery');

  const pickupsTab = page.locator('.cashier-subnav__button', { hasText: 'Retiradas' });
  await pickupsTab.click();
  const pickups = page.locator('#cashier-pickups-workspace');
  await expect(pickups).toBeVisible();
  await expect(pickups).toContainText('Bruno Delivery');
  await expect(pickups).toContainText('Em preparo');

  await pickups.getByRole('button', { name: 'Marcar pronto para retirada' }).click();
  await expect(pickups).toContainText('Pronto para retirada');
  await pickups.getByRole('button', { name: 'Receber e concluir retirada' }).click();
  await expect(page.getByText('CHECKOUT / CAIXA')).toBeVisible();
  await expectNoHorizontalOverflow(page);
});
