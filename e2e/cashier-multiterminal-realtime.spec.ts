import { expect, test, type Browser, type Page, type WebSocketRoute } from '@playwright/test';

const API_ORIGIN = 'http://127.0.0.1:8000';
const now = new Date().toISOString();

type SharedOrder = {
  id: string;
  restaurante_id: number;
  mesa_id: null;
  garcom_id: string;
  tipo: 'Delivery' | 'Retirada';
  identificador: string;
  numero_pedido: number;
  fechada: boolean;
  valor_pago: number;
  criado_em: string;
  delivery_status: string;
  delivery_telefone: string;
  delivery_endereco: string | null;
  delivery_taxa: number;
  delivery_forma_pagamento: string;
  delivery_troco_para: number | null;
  motoboy_id: number | null;
  lancamentos: Array<{ id: string; origem: string; timestamp: string }>;
  itens: Array<{
    id: string;
    lancamento_id: string;
    produto_id: string;
    preco_unit: number;
    observacao: string;
    cliente_nome: string;
    status: string;
    pago: boolean;
    produto: { id: string; nome: string; preco: number; ativo: boolean };
  }>;
};

type SharedState = { order: SharedOrder };

const cashierConfig = {
  plano: 'pro',
  plano_efetivo: 'pro',
  entitlements: {
    printing: true,
    kds: true,
    waiter_app: true,
    loyalty: false,
    coupons: false,
    courier_app: false,
    inventory: true,
    advanced_reports: true,
  },
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

function makeState(id: string, numero: number, cliente: string): SharedState {
  return {
    order: {
      id,
      restaurante_id: 99001,
      mesa_id: null,
      garcom_id: 'caixa-realtime',
      tipo: 'Delivery',
      identificador: cliente,
      numero_pedido: numero,
      fechada: false,
      valor_pago: 0,
      criado_em: now,
      delivery_status: 'producao',
      delivery_telefone: '85999990002',
      delivery_endereco: 'Rua Realtime, 123',
      delivery_taxa: 5,
      delivery_forma_pagamento: 'dinheiro',
      delivery_troco_para: null,
      motoboy_id: null,
      lancamentos: [{ id: `launch-${id}`, origem: 'cardapio', timestamp: now }],
      itens: [{
        id: `item-${id}`,
        lancamento_id: `launch-${id}`,
        produto_id: '102',
        preco_unit: 55,
        observacao: '',
        cliente_nome: cliente,
        status: 'preparando',
        pago: false,
        produto: { id: '102', nome: 'Pizza Realtime', preco: 55, ativo: true },
      }],
    },
  };
}

async function seedCashierSession(page: Page, subTab: string) {
  await page.addInitScript((initialSubTab) => {
    localStorage.setItem('koma_caixa_token', 'playwright-realtime-token');
    localStorage.setItem('koma_caixa_id', 'caixa-realtime');
    localStorage.setItem('koma_caixa_name', 'Caixa Realtime');
    localStorage.setItem('koma_caixa_role', 'caixa');
    localStorage.setItem('token', 'playwright-realtime-token');
    sessionStorage.setItem('koma_active_tab', 'operacao');
    sessionStorage.setItem('koma_active_subtab', initialSubTab);
  }, subTab);
}

function broadcastOrders(sockets: Set<WebSocketRoute>, detail: Record<string, unknown> = {}) {
  const payload = JSON.stringify({ event: 'tables_updated', detail });
  for (const socket of sockets) socket.send(payload);
}

async function installSharedBackend(
  page: Page,
  state: SharedState,
  sockets: Set<WebSocketRoute>,
) {
  await page.routeWebSocket(/\/ws\//, socket => {
    sockets.add(socket);
    socket.onMessage(() => {});
  });

  await page.route(`${API_ORIGIN}/**`, async route => {
    const request = route.request();
    const url = new URL(request.url());
    const { pathname } = url;

    if (pathname === '/comandas/detalhes/todos' || pathname === '/comandas/delivery/ativos') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([state.order]) });
      return;
    }

    if (
      pathname === '/comandas/delivery/retiradas/concluidas-recentes'
      || pathname === '/comandas/delivery/entregas/concluidas-recentes'
      || pathname === '/mesas/'
      || pathname === '/caixa/pagamentos/pendentes'
      || pathname === '/auth/usuarios'
      || pathname === '/chat/caixa/conversas'
    ) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
      return;
    }

    if (pathname === '/produtos/catalogo') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          categorias: [{ id: 'cat-pizza', nome: 'Pizzas', destino_impressao: 'COZINHA' }],
          produtos: [{ id: '102', nome: 'Pizza Realtime', preco: 55, categoria_id: 'cat-pizza', ativo: true }],
        }),
      });
      return;
    }

    if (pathname === '/comandas/motoboys/lista') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([{ id: 7, nome: 'Pedro Realtime', telefone: '85999990007', ativo: true }]),
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
          aberto_por_id: 'caixa-realtime',
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
          operador_id: 'caixa-realtime',
          operador_nome: 'Caixa Realtime',
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

    if (pathname === '/auth/smartpos/caixa/operacao') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
      return;
    }

    if (pathname.endsWith('/status') && pathname.includes('/comandas/itens/') && request.method() === 'PUT') {
      const next = url.searchParams.get('status') || 'preparando';
      state.order.itens = state.order.itens.map(item => ({ ...item, status: next }));
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(state.order.itens[0]) });
      broadcastOrders(sockets, { type: 'item_status_updated', comanda_id: state.order.id });
      return;
    }

    if (pathname.endsWith('/delivery/entregador') && request.method() === 'PUT') {
      const body = request.postDataJSON() as { motoboy_id?: number | null };
      state.order = { ...state.order, motoboy_id: body.motoboy_id ?? null };
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(state.order) });
      broadcastOrders(sockets, { type: 'courier_assigned', comanda_id: state.order.id });
      return;
    }

    if (pathname.endsWith('/delivery/status') && request.method() === 'PUT') {
      const next = url.searchParams.get('status_novo') || state.order.delivery_status;
      state.order = { ...state.order, delivery_status: next };
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(state.order) });
      broadcastOrders(sockets, { type: 'order_status_updated', comanda_id: state.order.id });
      return;
    }

    if (pathname.endsWith('/delivery/despachar') && request.method() === 'POST') {
      const body = request.postDataJSON() as { motoboy_id?: number | null };
      state.order = {
        ...state.order,
        delivery_status: 'transito',
        motoboy_id: body.motoboy_id ?? state.order.motoboy_id,
      };
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(state.order) });
      broadcastOrders(sockets, { type: 'delivery_dispatched', comanda_id: state.order.id });
      return;
    }

    if (pathname.endsWith('/delivery/converter-retirada') && request.method() === 'POST') {
      const body = request.postDataJSON() as { motivo?: string };
      if (String(body.motivo || '').trim().length < 3) {
        await route.fulfill({ status: 422, contentType: 'application/json', body: JSON.stringify({ detail: 'Motivo obrigatório' }) });
        return;
      }
      state.order = {
        ...state.order,
        tipo: 'Retirada',
        motoboy_id: null,
        delivery_taxa: 0,
      };
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(state.order) });
      broadcastOrders(sockets, {
        type: 'fulfillment_changed',
        comanda_id: state.order.id,
        fulfillment_from: 'delivery',
        fulfillment_to: 'pickup',
      });
      return;
    }

    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
}

async function openTerminal(
  browser: Browser,
  subTab: string,
  state: SharedState,
  sockets: Set<WebSocketRoute>,
) {
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const page = await context.newPage();
  await seedCashierSession(page, subTab);
  await installSharedBackend(page, state, sockets);
  await page.goto('/?view=caixa');
  return { context, page };
}

test('três terminais convergem Cozinha → Pedidos → Entregas pelo WebSocket sem refresh', async ({ browser }) => {
  const state = makeState('delivery-realtime-e2e', 6101, 'Cliente Realtime');
  const sockets = new Set<WebSocketRoute>();
  const pedidos = await openTerminal(browser, 'pedidos', state, sockets);
  const cozinha = await openTerminal(browser, 'kds', state, sockets);
  const entregas = await openTerminal(browser, 'entregadores', state, sockets);

  try {
    await expect.poll(() => sockets.size >= 3).toBe(true);

    const pedidosCard = pedidos.page.locator('.orders-card--digital').filter({ hasText: 'Cliente Realtime' });
    const entregasWorkspace = entregas.page.locator('#cashier-deliveries-workspace');

    await expect(pedidosCard).toBeVisible();
    await expect(entregasWorkspace).toContainText('Cliente Realtime');
    await expect(entregasWorkspace).toContainText('Em preparo');

    await cozinha.page.getByRole('button', { name: 'Marcar como pronto: Pizza Realtime' }).click();

    await expect(pedidosCard).toContainText('Cozinha concluída');
    await expect(pedidosCard).toContainText('Aguarda avanço do pedido');
    await expect(pedidosCard.getByRole('button', { name: 'Pronto para sair' })).toBeVisible();
    await expect(entregasWorkspace).toContainText('Em preparo');
    await expect(entregasWorkspace).not.toContainText('Em rota');

    const courierSelect = pedidosCard.getByRole('combobox', { name: /Entregador do pedido 6101/i });
    await courierSelect.selectOption('7');
    await expect(
      entregasWorkspace.getByRole('combobox', { name: /Entregador do pedido 6101/i }),
    ).toHaveValue('7');

    await pedidosCard.getByRole('button', { name: 'Pronto para sair' }).click();
    await expect(entregasWorkspace).toContainText('Prontos para sair');
    await expect(entregasWorkspace.getByRole('button', { name: 'Saiu para entrega' })).toBeEnabled();

    await entregasWorkspace.getByRole('button', { name: 'Saiu para entrega' }).click();

    const inRouteCard = pedidos.page.locator('.orders-card--closing').filter({ hasText: 'Cliente Realtime' });
    await expect(inRouteCard).toContainText('EM ROTA');
    await expect(inRouteCard).toContainText('Pedro Realtime');
    await expect(entregasWorkspace).toContainText('Em rota');
    await expect(entregasWorkspace).toContainText('Pedro Realtime');
  } finally {
    await Promise.all([pedidos.context.close(), cozinha.context.close(), entregas.context.close()]);
  }
});

test('mudança Delivery → Retirada converge em Pedidos, Entregas e Retiradas sem refresh', async ({ browser }) => {
  const state = makeState('conversion-realtime-e2e', 6201, 'Cliente Conversão Realtime');
  const sockets = new Set<WebSocketRoute>();
  const pedidos = await openTerminal(browser, 'pedidos', state, sockets);
  const entregas = await openTerminal(browser, 'entregadores', state, sockets);
  const retiradas = await openTerminal(browser, 'retiradas', state, sockets);

  try {
    await expect.poll(() => sockets.size >= 3).toBe(true);

    const entregasWorkspace = entregas.page.locator('#cashier-deliveries-workspace');
    const retiradasWorkspace = retiradas.page.locator('#cashier-pickups-workspace');
    await expect(entregasWorkspace).toContainText('Cliente Conversão Realtime');
    await expect(retiradasWorkspace).not.toContainText('Cliente Conversão Realtime');

    await entregasWorkspace.getByRole('button', { name: 'Alterar para retirada' }).click();
    const dialog = entregas.page.getByRole('dialog', { name: 'Alterar para retirada' });
    await dialog.getByRole('textbox', { name: 'Motivo da alteração para retirada' })
      .fill('Cliente decidiu passar no restaurante');
    await dialog.getByRole('button', { name: 'Confirmar retirada' }).click();

    await expect(dialog).toBeHidden();
    await expect(entregasWorkspace).not.toContainText('Cliente Conversão Realtime');
    await expect(retiradasWorkspace).toContainText('Cliente Conversão Realtime');
    await expect(retiradasWorkspace).toContainText('Em preparo');

    const pedidosCard = pedidos.page.locator('.orders-card--digital').filter({ hasText: 'Cliente Conversão Realtime' });
    await expect(pedidosCard).toBeVisible();
    await expect(pedidosCard.getByRole('button', { name: 'Pronto para retirada' })).toBeVisible();
    await expect(pedidosCard.getByRole('combobox', { name: /Entregador do pedido 6201/i })).toHaveCount(0);
  } finally {
    await Promise.all([pedidos.context.close(), entregas.context.close(), retiradas.context.close()]);
  }
});
