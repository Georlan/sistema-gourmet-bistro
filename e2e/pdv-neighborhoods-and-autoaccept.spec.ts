import { expect, test, type Page, type WebSocketRoute } from '@playwright/test';
import { mockCashierBackend, seedCashierSession } from './fixtures/cashier';

const TENANT_ID = 6;

const TENANT_6_PRODUCTS = [
  {
    id: 'prod-qg',
    nome: 'Quentinha G',
    categoria: 'Marmitas',
    categoria_id: 'cat-marmitas',
    preco: 14,
    ativo: true,
    descricao: 'Marmita grande completa',
  },
  {
    id: 'prod-refri',
    nome: 'Refrigerante 2L',
    categoria: 'Bebidas',
    categoria_id: 'cat-bebidas',
    preco: 10,
    ativo: true,
    descricao: 'Guaraná ou Cola',
  },
];

async function openCartPanelIfCollapsed(page: Page) {
  if ((page.viewportSize()?.width || 1366) < 1280) {
    const reviewBtn = page.locator('#pdv-review-btn');
    if (await reviewBtn.isVisible()) {
      await reviewBtn.click();
    }
  }
  await expect(page.locator('#pdv-order-panel')).toBeVisible();
}

async function selectPdvModality(page: Page, label: 'Delivery' | 'Retirada') {
  const panel = page.locator('#pdv-order-panel');
  await panel.locator('.cashier-pdv-cart__modality-option').filter({ hasText: label }).click();
}

test('PDV aplica taxas por bairro do perfil ID 6, frete grátis, retirada sem taxa e invalida cache via evento', async ({ page }) => {
  await page.route('https://fonts.googleapis.com/**', (route) => route.fulfill({ contentType: 'text/css', body: '' }));
  await mockCashierBackend(page);
  await seedCashierSession(page);

  await page.addInitScript(() => {
    sessionStorage.setItem('koma_active_tab', 'operacao');
    sessionStorage.setItem('koma_active_subtab', 'balcao');
    (window as unknown as { __komaConfigUpdatedEvents: number }).__komaConfigUpdatedEvents = 0;
    window.addEventListener('koma_cardapio_config_updated', () => {
      (window as unknown as { __komaConfigUpdatedEvents: number }).__komaConfigUpdatedEvents += 1;
    });
  });

  let socket: WebSocketRoute | undefined;
  await page.routeWebSocket(/\/ws\//, (ws) => {
    socket = ws;
    ws.onMessage(() => {});
  });

  await page.route('**/produtos/catalogo', (route) => route.fulfill({
    json: {
      categorias: [
        { id: 'cat-marmitas', nome: 'Marmitas', destino_impressao: 'COZINHA' },
        { id: 'cat-bebidas', nome: 'Bebidas', destino_impressao: 'BAR' },
      ],
      produtos: TENANT_6_PRODUCTS,
    },
  }));

  await page.route('**/api/cardapio-digital/promocoes', (route) => route.fulfill({
    json: { perfil_marmitaria: true, promocoes: [], produtos: TENANT_6_PRODUCTS, categorias: [] },
  }));

  let configFetchCount = 0;
  let configPayload = {
    id: TENANT_ID,
    slug: 'quentinha-caseira-fixture',
    nome: 'Quentinha Caseira Fixture',
    frete_gratis_valor: 40,
    tipo_taxa_entrega: 'bairro',
    taxa_entrega_fixa: 2,
    tabela_taxas_bairros: [
      { bairro: 'Bom Nome', taxa: 2 },
      { bairro: 'Santa Luzia', taxa: 3 },
      { bairro: 'Canafístula', taxa: 7 },
    ],
  };

  await page.route('**/api/cardapio-digital/config*', (route) => {
    configFetchCount += 1;
    return route.fulfill({ json: configPayload });
  });

  await page.goto('/?view=caixa');
  await expect.poll(() => Boolean(socket)).toBe(true);
  await expect(page.getByRole('button', { name: 'Adicionar Quentinha G rapidamente', exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Adicionar Quentinha G rapidamente', exact: true }).click();
  await openCartPanelIfCollapsed(page);

  await selectPdvModality(page, 'Delivery');
  const bairroInput = page.locator('#pdv-delivery-address-bairro');
  if (!(await bairroInput.isVisible())) {
    await page.locator('.cashier-pdv-service-detail__delivery summary').click();
  }
  await expect(bairroInput).toBeVisible();

  const datalistValues = await page
    .locator('#pdv-delivery-address-bairro-options option')
    .evaluateAll((opts) => opts.map((el) => el.getAttribute('value')));
  expect(datalistValues).toEqual(['Bom Nome', 'Santa Luzia', 'Canafístula']);

  const footer = page.locator('.cashier-pdv-cart__footer');

  // Bom Nome -> taxa R$ 2,00 (14 + 2 = 16)
  await bairroInput.fill('Bom Nome');
  await expect(footer).toContainText('Taxa de entrega (Bom Nome)');
  await expect(footer).toContainText('R$ 2,00');
  await expect(footer.locator('.cashier-pdv-cart__total-value')).toContainText('R$ 16,00');

  // Santa Luzia -> taxa R$ 3,00 (14 + 3 = 17)
  await bairroInput.fill('Santa Luzia');
  await expect(footer).toContainText('Taxa de entrega (Santa Luzia)');
  await expect(footer).toContainText('R$ 3,00');
  await expect(footer.locator('.cashier-pdv-cart__total-value')).toContainText('R$ 17,00');

  // Canafístula -> taxa R$ 7,00 (14 + 7 = 21)
  await bairroInput.fill('Canafístula');
  await expect(footer).toContainText('Taxa de entrega (Canafístula)');
  await expect(footer).toContainText('R$ 7,00');
  await expect(footer.locator('.cashier-pdv-cart__total-value')).toContainText('R$ 21,00');

  // Frete grátis ao atingir >= R$ 40,00 (3 x R$ 14,00 = R$ 42,00)
  const increaseBtn = page.getByRole('button', { name: 'Aumentar quantidade de Quentinha G', exact: true });
  await increaseBtn.click();
  await increaseBtn.click();
  await expect(footer).toContainText('R$ 42,00');
  await expect(footer).toContainText('Grátis');
  await expect(footer.locator('.cashier-pdv-cart__total-value')).toContainText('R$ 42,00');

  // Volta para 1 unidade (R$ 14 + R$ 7 = R$ 21) e valida Retirada sem taxa
  const decreaseBtn = page.getByRole('button', { name: 'Diminuir quantidade de Quentinha G', exact: true });
  await decreaseBtn.click();
  await decreaseBtn.click();
  await expect(footer.locator('.cashier-pdv-cart__total-value')).toContainText('R$ 21,00');

  await selectPdvModality(page, 'Retirada');
  await expect(footer.getByText('Taxa de entrega')).toHaveCount(0);
  await expect(footer.locator('.cashier-pdv-cart__total-value')).toContainText('R$ 14,00');

  // Alteração dinâmica da config via WebSocket (config_updated) invalida cache e emite evento
  const fetchesBeforeUpdate = configFetchCount;
  const eventsBeforeUpdate = await page.evaluate(
    () => (window as unknown as { __komaConfigUpdatedEvents: number }).__komaConfigUpdatedEvents,
  );
  configPayload = {
    ...configPayload,
    frete_gratis_valor: 100,
    tabela_taxas_bairros: [
      { bairro: 'Bom Nome', taxa: 2 },
      { bairro: 'Santa Luzia', taxa: 5 },
      { bairro: 'Canafístula', taxa: 7 },
    ],
  };
  socket!.send(JSON.stringify({ event: 'config_updated' }));
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { __komaConfigUpdatedEvents: number }).__komaConfigUpdatedEvents,
      ),
    )
    .toBeGreaterThan(eventsBeforeUpdate);

  // Ao retornar para Delivery, cache invalidado força nova leitura e aplica taxa atualizada (Santa Luzia R$ 5)
  await selectPdvModality(page, 'Delivery');
  await expect.poll(() => configFetchCount).toBeGreaterThan(fetchesBeforeUpdate);
  const bairroInputAfter = page.locator('#pdv-delivery-address-bairro');
  if (!(await bairroInputAfter.isVisible())) {
    await page.locator('.cashier-pdv-service-detail__delivery summary').click();
  }
  await bairroInputAfter.fill('Santa Luzia');
  await expect(footer).toContainText('Taxa de entrega (Santa Luzia)');
  await expect(footer).toContainText('R$ 5,00');
  await expect(footer.locator('.cashier-pdv-cart__total-value')).toContainText('R$ 19,00');
});

test('Caixa reflete autoaceite ativo vs manual, sincroniza por evento e preserva pedidos Pix pendente/aprovado', async ({ page }) => {
  await page.route('https://fonts.googleapis.com/**', (route) => route.fulfill({ contentType: 'text/css', body: '' }));
  await mockCashierBackend(page);
  await seedCashierSession(page);

  let socket: WebSocketRoute | undefined;
  await page.routeWebSocket(/\/ws\//, (ws) => {
    socket = ws;
    ws.onMessage(() => {});
  });

  let autoAcceptEnabled = true;
  let pendingPixRows = [
    {
      id: 'pix-intent-47',
      order_number: '47',
      customer: 'Cliente Pix Aprovado',
      customer_phone: '88999990047',
      amount: '16.00',
      customer_reported: true,
      released_unpaid: false,
    },
  ];
  let digitalOrders: Array<Record<string, unknown>> = [
    {
      id: 'ord-auto-del',
      restaurante_id: TENANT_ID,
      numero_pedido: 501,
      tipo: 'Delivery',
      identificador: 'Cliente Auto Delivery',
      fechada: false,
      valor_pago: 0,
      delivery_status: 'aceito',
      delivery_taxa: 2,
      delivery_endereco: 'Rua Central, 10 - Bom Nome',
      delivery_telefone: '88999990001',
      delivery_forma_pagamento: 'pix',
      online_payment_status: 'approved',
      criado_em: new Date().toISOString(),
      lancamentos: [{ id: 'l-501', origem: 'cardapio', status: 'aceito' }],
      itens: [
        {
          id: 'it-501',
          produto_id: 'prod-qg',
          produto: { nome: 'Quentinha G' },
          preco_unit: 14,
          pago: false,
          status: 'preparando',
          lancamento_id: 'l-501',
        },
      ],
    },
    {
      id: 'ord-auto-ret',
      restaurante_id: TENANT_ID,
      numero_pedido: 502,
      tipo: 'Retirada',
      identificador: 'Cliente Auto Retirada',
      fechada: false,
      valor_pago: 0,
      delivery_status: 'aceito',
      delivery_taxa: 0,
      delivery_telefone: '88999990002',
      delivery_forma_pagamento: 'dinheiro',
      criado_em: new Date().toISOString(),
      lancamentos: [{ id: 'l-502', origem: 'cardapio', status: 'aceito' }],
      itens: [
        {
          id: 'it-502',
          produto_id: 'prod-qg',
          produto: { nome: 'Quentinha G' },
          preco_unit: 14,
          pago: false,
          status: 'preparando',
          lancamento_id: 'l-502',
        },
      ],
    },
    {
      id: 'ord-pix-released',
      restaurante_id: TENANT_ID,
      numero_pedido: 504,
      tipo: 'Delivery',
      identificador: 'Cliente Pix Liberado',
      fechada: false,
      valor_pago: 0,
      delivery_status: 'aceito',
      delivery_taxa: 2,
      delivery_endereco: 'Rua Sol, 50 - Bom Nome',
      delivery_telefone: '88999990504',
      delivery_forma_pagamento: 'pix',
      online_payment_status: 'pending_released',
      criado_em: new Date().toISOString(),
      lancamentos: [{ id: 'l-504', origem: 'cardapio', status: 'aceito' }],
      itens: [
        {
          id: 'it-504',
          produto_id: 'prod-qg',
          produto: { nome: 'Quentinha G' },
          preco_unit: 14,
          pago: false,
          status: 'preparando',
          lancamento_id: 'l-504',
        },
      ],
    },
  ];

  await page.route('**/api/online-orders/control', (route) => route.fulfill({
    json: {
      paused: false,
      pause_reason: null,
      pause_until: null,
      max_active_orders: null,
      auto_pause: false,
      auto_accept: autoAcceptEnabled,
      counts: {
        analise: 0,
        pendente: digitalOrders.filter((o) => o.delivery_status === 'pendente').length,
        producao: digitalOrders.filter((o) => o.delivery_status === 'aceito' || o.delivery_status === 'producao').length,
        pronto: 0,
        active: digitalOrders.length,
      },
      capacity_ratio: null,
      level: 'normal',
    },
  }));

  await page.route('**/payments/direct-pix/pending', (route) => route.fulfill({ json: pendingPixRows }));
  await page.route('**/payments/direct-pix/pix-intent-47/confirm', async (route) => {
    pendingPixRows = [];
    digitalOrders = [
      ...digitalOrders,
      {
        id: 'ord-pix-47',
        restaurante_id: TENANT_ID,
        numero_pedido: 47,
        tipo: 'Delivery',
        identificador: 'Cliente Pix Aprovado',
        fechada: false,
        valor_pago: 0,
        delivery_status: 'aceito',
        delivery_taxa: 2,
        delivery_endereco: 'Rua Nova, 47 - Bom Nome',
        delivery_telefone: '88999990047',
        delivery_forma_pagamento: 'pix',
        online_payment_status: 'approved',
        criado_em: new Date().toISOString(),
        lancamentos: [{ id: 'l-47', origem: 'cardapio', status: 'aceito' }],
        itens: [
          {
            id: 'it-47',
            produto_id: 'prod-qg',
            produto: { nome: 'Quentinha G' },
            preco_unit: 14,
            pago: false,
            status: 'preparando',
            lancamento_id: 'l-47',
          },
        ],
      },
    ];
    await route.fulfill({ json: { status: 'approved', already_confirmed: false } });
    socket?.send(JSON.stringify({ event: 'tables_updated' }));
  });

  await page.route('**/comandas/delivery/ativos', (route) => route.fulfill({ json: digitalOrders }));
  await page.route('**/comandas/delivery/pendentes', (route) =>
    route.fulfill({ json: digitalOrders.filter((o) => o.delivery_status === 'pendente') }),
  );
  await page.route('**/comandas/detalhes/todos?*', (route) => route.fulfill({ json: digitalOrders }));
  await page.route('**/comandas/*/delivery/status?*', async (route) => {
    const id = new URL(route.request().url()).pathname.split('/')[2];
    const nextStatus = new URL(route.request().url()).searchParams.get('status_novo') || 'aceito';
    digitalOrders = digitalOrders.map((order) =>
      order.id === id ? { ...order, delivery_status: nextStatus } : order,
    );
    const updated = digitalOrders.find((order) => order.id === id);
    await route.fulfill({ json: updated || {} });
  });

  await page.goto('/?view=caixa');
  await expect(page.locator('.orders-board')).toBeVisible();
  await expect.poll(() => Boolean(socket)).toBe(true);

  const autoAcceptSwitch = page.getByRole('checkbox', { name: 'Aceitar pedidos online automaticamente' });
  await expect(autoAcceptSwitch).toBeChecked();
  await expect(page.locator('.orders-auto-accept__label small')).toHaveText('Ativo');

  // Autoaceite ativo: pedidos aparecem diretamente nas filas Entregas e Retiradas
  const mobileStages = page.getByRole('tablist', { name: 'Filas de atendimento' });
  if (await mobileStages.isVisible()) {
    await mobileStages.getByRole('tab', { name: /Entregas/ }).click();
  }
  await expect(page.locator('.orders-column--delivery')).toContainText('Cliente Auto Delivery');
  await expect(page.locator('.orders-column--delivery')).toContainText('Pago · Pix');
  await expect(page.locator('.orders-column--delivery')).toContainText('Cliente Pix Liberado');
  await expect(page.locator('.orders-column--delivery')).toContainText('A cobrar R$ 16,00 · Pix');

  if (await mobileStages.isVisible()) {
    await mobileStages.getByRole('tab', { name: /Retiradas/ }).click();
  }
  await expect(page.locator('.orders-column--digital')).toContainText('Cliente Auto Retirada');

  // Drawer "Novos pedidos" explica claramente que o aceite automático está ativo
  await page.getByRole('button', { name: /Novos pedidos/ }).click();
  const drawer = page.getByRole('dialog', { name: 'Novos pedidos' });
  await expect(drawer).toBeVisible();
  await expect(drawer).toContainText('Aceite automático ativo');
  await expect(drawer).toContainText('Entregas, Retiradas ou Mesas');
  await expect(drawer).not.toContainText('Nenhum pedido pendente');
  await drawer.getByRole('button', { name: 'Fechar novos pedidos' }).click();
  await expect(drawer).toBeHidden();

  // Pix pendente fica acessível em "Conferir Pix" e entra na operação após confirmação
  const pixBtn = page.getByRole('button', { name: /Conferir Pix/ });
  await expect(pixBtn).toContainText('1');
  await pixBtn.click();
  const pixPanel = page.getByRole('dialog', { name: /Pix manual/ });
  await expect(pixPanel).toBeVisible();
  await pixPanel.getByLabel('Conferi o Pix na conta bancária').check();
  await pixPanel.getByRole('button', { name: 'Confirmar Pix recebido' }).click();
  await expect(pixPanel).toContainText('Nenhum Pix pendente.');
  await pixPanel.getByRole('button', { name: 'Fechar conferência Pix' }).click();
  await expect(pixPanel).toBeHidden();

  if (await mobileStages.isVisible()) {
    await mobileStages.getByRole('tab', { name: /Entregas/ }).click();
  }
  await expect(page.locator('.orders-column--delivery')).toContainText('Cliente Pix Aprovado');

  // Outro operador desativa autoaceite e chega um pedido pendente manual -> WS sincroniza
  autoAcceptEnabled = false;
  digitalOrders = [
    ...digitalOrders,
    {
      id: 'ord-manual-503',
      restaurante_id: TENANT_ID,
      numero_pedido: 503,
      tipo: 'Delivery',
      identificador: 'Cliente Manual Pendente',
      fechada: false,
      valor_pago: 0,
      delivery_status: 'pendente',
      delivery_taxa: 3,
      delivery_endereco: 'Rua Boa Vista, 50 - Santa Luzia',
      delivery_telefone: '88999990003',
      delivery_forma_pagamento: 'dinheiro',
      delivery_troco_para: 50,
      criado_em: new Date().toISOString(),
      lancamentos: [{ id: 'l-503', origem: 'cardapio', status: 'pendente' }],
      itens: [
        {
          id: 'it-503',
          produto_id: 'prod-qg',
          produto: { nome: 'Quentinha G' },
          preco_unit: 14,
          pago: false,
          status: 'preparando',
          lancamento_id: 'l-503',
        },
      ],
    },
  ];
  socket!.send(JSON.stringify({ event: 'tables_updated', source: 'online_order_control' }));

  await expect(autoAcceptSwitch).not.toBeChecked();
  await expect(page.locator('.orders-auto-accept__label small')).toHaveText('Manual');
  await expect(page.locator('.orders-new-orders__count')).toHaveText('1');

  await page.getByRole('button', { name: /Novos pedidos/ }).click();
  await expect(drawer.locator('.orders-pending-card')).toContainText('Cliente Manual Pendente');
  await drawer.locator('.orders-pending-card').getByRole('button', { name: 'Aceitar', exact: true }).click();
  await expect(drawer).toBeHidden();

  if (await mobileStages.isVisible()) {
    await mobileStages.getByRole('tab', { name: /Entregas/ }).click();
  }
  await expect(page.locator('.orders-column--delivery')).toContainText('Cliente Manual Pendente');

  // Com autoaceite desativado e fila vazia, mantém "Nenhum pedido pendente"
  await page.getByRole('button', { name: /Novos pedidos/ }).click();
  await expect(drawer).toContainText('Nenhum pedido pendente');
  await expect(drawer).not.toContainText('Aceite automático ativo');
});
