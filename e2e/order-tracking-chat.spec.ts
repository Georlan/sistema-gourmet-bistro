import { expect, Page, test } from '@playwright/test';

const API_ORIGIN = 'http://127.0.0.1:8000';
const now = new Date().toISOString();

const trackingToken = 'track-token-sec-e2e-abc-123';
const orderId = 'c-online-e2e';
const convId = 'conv-e2e-4321';

let orderStatus = 'producao';
let chatMessages: Array<{
  id: string;
  conversation_id: string;
  pedido_id: string;
  sender_type: 'system' | 'customer' | 'staff';
  sender_user_id?: number | null;
  body: string;
  event_key?: string | null;
  created_at: string;
}> = [
  {
    id: 'msg-sys-1',
    conversation_id: convId,
    pedido_id: orderId,
    sender_type: 'system',
    body: 'Pedido recebido pelo restaurante.',
    event_key: 'order_created',
    created_at: new Date(Date.now() - 5 * 60_000).toISOString(),
  },
];

const mockOrder = {
  id: orderId,
  numero_pedido: 4321,
  status: 'producao',
  tipo: 'Delivery',
  criado_em: now,
  total: 48,
  delivery_taxa: 5,
  delivery_endereco: 'Rua das Flores, 123',
  delivery_bairro: 'Centro',
  forma_pagamento: 'Pix',
  restaurante: {
    id: 99001,
    nome: 'Bistrô Gourmet E2E',
    slug: 'bistro-gourmet',
  },
  itens: [
    {
      id: 'item-1',
      nome: 'Pizza Margherita',
      quantidade: 1,
      preco_unitario: 48,
      observacao: 'Sem cebola',
    },
  ],
  closed_at: null,
};

async function setupChatRoutes(page: Page) {
  await page.route(`${API_ORIGIN}/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const { pathname } = url;
    const method = request.method();

    // 1. Order Tracking Public Endpoints
    if (pathname === `/api/cardapio/pedidos/acompanhar/${trackingToken}` && method === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ...mockOrder, status: orderStatus }),
      });
    }

    if (pathname === `/api/cardapio/pedidos/acompanhar/${trackingToken}/messages` && method === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(chatMessages),
      });
    }

    if (pathname === `/api/cardapio/pedidos/acompanhar/${trackingToken}/messages` && method === 'POST') {
      const payload = JSON.parse(request.postData() || '{}');
      const newMsg = {
        id: `msg-cust-${Date.now()}`,
        conversation_id: convId,
        pedido_id: orderId,
        sender_type: 'customer' as const,
        body: payload.body || payload.text || '',
        created_at: new Date().toISOString(),
      };
      chatMessages.push(newMsg);
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(newMsg),
      });
    }

    if (pathname === `/api/cardapio/pedidos/acompanhar/${trackingToken}/read` && method === 'POST') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true }),
      });
    }

    if (pathname === `/api/cardapio/pedidos/acompanhar/${trackingToken}/events`) {
      return route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: ': keepalive\n\n',
      });
    }

    // 2. Caixa Staff Endpoints
    if (pathname === '/api/caixa/conversas/unread-count' && method === 'GET') {
      const unread = chatMessages.filter(
        (m) => m.sender_type === 'customer'
      ).length;
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ total_unread: unread }),
      });
    }

    if (pathname === '/api/caixa/conversas' && method === 'GET') {
      const lastMsg = chatMessages[chatMessages.length - 1] || null;
      const unread = chatMessages.filter(
        (m) => m.sender_type === 'customer'
      ).length;
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            id: convId,
            pedido_id: orderId,
            numero_pedido: 4321,
            cliente_nome: 'Ana Teste',
            tipo_pedido: 'Delivery',
            status_pedido: orderStatus,
            total_pedido: 53,
            unread_count: unread,
            closed_at: null,
            updated_at: now,
            last_message: lastMsg,
          },
        ]),
      });
    }

    if (pathname === `/api/caixa/conversas/${convId}/messages` && method === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(chatMessages),
      });
    }

    if (pathname === `/api/caixa/conversas/${convId}/messages` && method === 'POST') {
      const payload = JSON.parse(request.postData() || '{}');
      const newMsg = {
        id: `msg-staff-${Date.now()}`,
        conversation_id: convId,
        pedido_id: orderId,
        sender_type: 'staff' as const,
        sender_user_id: 1,
        body: payload.body || payload.text || '',
        created_at: new Date().toISOString(),
      };
      chatMessages.push(newMsg);
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(newMsg),
      });
    }

    if (pathname === `/api/caixa/conversas/${convId}/read` && method === 'POST') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true }),
      });
    }

    // Standard Caixa operation mocks
    if (pathname === '/comandas/delivery/ativos' || pathname === '/comandas/detalhes/todos') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            id: orderId,
            restaurante_id: 99001,
            mesa_id: null,
            garcom_id: 'caixa-e2e',
            tipo: 'Delivery',
            identificador: 'Ana Teste',
            numero_pedido: 4321,
            fechada: false,
            valor_pago: 0,
            criado_em: now,
            delivery_status: orderStatus,
            delivery_telefone: '85999999999',
            delivery_endereco: 'Rua das Flores, 123',
            delivery_taxa: 5,
            itens: [
              {
                id: 'item-1',
                produto_id: '101',
                preco_unit: 48,
                observacao: 'Sem cebola',
                cliente_nome: 'Ana Teste',
                status: 'preparando',
                pago: false,
                produto: { id: '101', nome: 'Pizza Margherita', preco: 48, ativo: true },
              },
            ],
          },
        ]),
      });
    }

    if (pathname === '/caixa/configuracoes') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
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
        }),
      });
    }

    if (pathname === '/caixa/turno/atual' || pathname === '/caixa/turno-atual/resumo') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 501,
          status: 'aberto',
          operador_id: 'caixa-e2e',
          operador_nome: 'Caixa E2E',
          aberto_em: now,
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
          movimentacoes: [],
          pagamentos: [],
        }),
      });
    }

    if (
      pathname === '/mesas/' ||
      pathname === '/caixa/pagamentos/pendentes' ||
      pathname === '/comandas/motoboys/lista' ||
      pathname === '/auth/usuarios' ||
      pathname === '/produtos/catalogo'
    ) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(pathname === '/produtos/catalogo' ? { categorias: [], produtos: [] } : []),
      });
    }

    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({}),
    });
  });
}

async function seedCashierSession(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('koma_caixa_token', 'playwright-chat-token');
    localStorage.setItem('koma_caixa_id', 'caixa-e2e');
    localStorage.setItem('koma_caixa_name', 'Caixa E2E');
    localStorage.setItem('koma_caixa_role', 'caixa');
    localStorage.setItem('token', 'playwright-chat-token');
    sessionStorage.setItem('koma_active_tab', 'operacao');
    sessionStorage.setItem('koma_active_subtab', 'pedidos');
  });
}

test.describe('Acompanhamento de Pedido e Chat em Tempo Real', () => {
  test('cliente acompanha pedido e conversa com restaurante via chat próprio', async ({
    page,
  }) => {
    await setupChatRoutes(page);

    // 1. Cliente acessa a página pública de acompanhamento com seu token
    await page.goto(`/acompanhar/${trackingToken}`);

    // Verifica que o cabeçalho e dados do pedido estão visíveis
    await expect(page.getByText('Pedido #4321')).toBeVisible();
    await expect(page.getByText('Pizza Margherita')).toBeVisible();
    await expect(page.getByText('Rua das Flores, 123')).toBeVisible();

    // Verifica que a timeline canônica está visível
    await expect(page.getByText('Em preparo').first()).toBeVisible();

    // Mensagem de sistema inicial deve estar visível
    await expect(page.getByText('Pedido recebido pelo restaurante.')).toBeVisible();

    // 2. Cliente envia uma mensagem no chat
    const customerInput = page.getByPlaceholder(/Envie uma mensagem para a equipe/i);
    await expect(customerInput).toBeVisible();
    await customerInput.fill('Por favor enviar talheres descartáveis');

    const sendButton = page.getByTitle(/Enviar mensagem/i);
    await sendButton.click();

    // Mensagem do cliente deve aparecer no feed de chat
    await expect(page.getByText('Por favor enviar talheres descartáveis')).toBeVisible();
    await expect(page.getByText('Você')).toBeVisible();
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('koma_active_orders') || '[]'));
    expect(saved.find((order: { id: string }) => order.id === orderId)?.tracking_token).toBe(trackingToken);
  });

  test('caixa visualiza notificação de conversa, abre drawer e responde ao cliente', async ({
    page,
  }) => {
    // Garante que há uma mensagem do cliente pendente
    if (!chatMessages.some((m) => m.sender_type === 'customer')) {
      chatMessages.push({
        id: 'msg-cust-init',
        conversation_id: convId,
        pedido_id: orderId,
        sender_type: 'customer',
        body: 'Por favor enviar talheres descartáveis',
        created_at: new Date().toISOString(),
      });
    }

    await seedCashierSession(page);
    await setupChatRoutes(page);

    // 1. Caixa acessa o painel operacional
    await page.goto('/?view=caixa');

    // 2. Localiza o botão "Conversas" com badge de não lidas
    const conversasBtn = page.getByRole('button', { name: /Conversas/i });
    await expect(conversasBtn).toBeVisible();
    await expect(conversasBtn.getByRole("status")).toHaveText(/[1-9]/);

    // Abre a gaveta de conversas
    await conversasBtn.click();
    if ((page.viewportSize()?.width || 0) > 768) {
      await page.locator('#cashier-chat-overlay').click({ position: { x: 4, y: 100 } });
      await expect(page.locator('#cashier-chat-panel')).toHaveCount(0);
      await conversasBtn.click();
    }

    // 3. Gaveta de conversas exibe a conversa do Pedido #4321
    const convCard = page.getByRole('button', { name: /Pedido #4321/i });
    await expect(convCard).toBeVisible();
    await expect(convCard).toContainText('Ana Teste');

    // Clica para abrir o thread
    await convCard.click();

    // Verifica que a mensagem enviada pelo cliente está no histórico (dentro do balão de chat)
    await expect(page.locator('div.rounded-2xl').filter({ hasText: 'Por favor enviar talheres descartáveis' })).toBeVisible();

    // 4. Caixa responde ao cliente
    const staffInput = page.getByPlaceholder(/Responder ao cliente/i);
    await expect(staffInput).toBeVisible();
    await staffInput.fill('Confirmado! Talheres descartáveis adicionados ao pedido.');

    const replyButton = page.getByTitle(/Enviar resposta/i);
    await replyButton.click();

    // Verifica que a resposta da equipe foi postada
    await expect(page.locator('div.rounded-2xl').filter({ hasText: 'Confirmado! Talheres descartáveis adicionados ao pedido.' })).toBeVisible();
    await expect(page.getByText('Equipe Caixa')).toBeVisible();
  });
});


test('card do Caixa permite salvar a observação durante o preparo', async ({ page }) => {
  await seedCashierSession(page);
  await setupChatRoutes(page);
  let update: unknown;
  await page.route('**/comandas/itens/item-1', async route => {
    update = route.request().postDataJSON();
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ id: 'item-1', observacao: 'Sem sal' }) });
  });
  await page.goto('/?view=caixa');
  await expect(page.getByRole('heading', { name: 'Vendas', exact: true })).toBeVisible();
  if ((page.viewportSize()?.width || 0) < 768) await page.getByRole('tab', { name: /Balcão/ }).click();
  await page.getByRole('button', { name: /delivery pedido 4321, ver detalhes/i }).click();
  const input = page.getByLabel('Observação — Pizza Margherita');
  await expect(input).toHaveValue('Sem cebola');
  await input.fill('Sem sal');
  await page.getByRole('button', { name: 'Salvar observação', exact: true }).click();
  await expect(page.getByText('Observação salva.', { exact: true })).toBeVisible();
  expect(update).toEqual({ observacao: 'Sem sal' });
  await expect(page.locator('.orders-detail-modal__observation')).toHaveText('Sem sal');
});
