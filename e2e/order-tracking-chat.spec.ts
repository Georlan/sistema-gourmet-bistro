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

    if (pathname === '/api/cardapio-digital/public' && method === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          restaurante: {
            id: 99001,
            nome: 'Bistrô Gourmet E2E',
            subtitulo: '',
            logo_url: '',
            banner_url: '',
            socials: {},
            horarios_funcionamento: [],
            formas_pagamento_aceitas: [],
            status_override: 'Forçado Aberto',
            aceitando_pedidos: true,
            delivery_ativo: true,
            pagamento_online_ativo: false,
          },
          categorias: [{ id: 1, nome: 'Pizzas' }],
          produtos: [
            {
              id: '101',
              nome: 'Pizza Margherita',
              descricao: 'Pizza de teste',
              preco: 48,
              categoria_id: 1,
              imagem_url: '',
              imagens_galeria: [],
              grupos_modificadores: [],
            },
          ],
        }),
      });
    }

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
  test('link legado leva o cliente ao acompanhamento lateral no cardápio', async ({
    page,
  }) => {
    await setupChatRoutes(page);

    await page.goto(`/acompanhar/${trackingToken}`);
    await page.waitForURL(/\/cardapio\?restaurante_id=99001/);

    const saved = await page.evaluate(() => JSON.parse(sessionStorage.getItem('koma_active_orders') || '[]'));
    expect(saved.find((order: { id: string }) => order.id === orderId)?.tracking_token).toBe(trackingToken);
    expect(await page.evaluate(() => localStorage.getItem('koma_active_orders'))).toBeNull();

    const floatingChat = page.locator('#floating-order-chat-trigger');
    await expect(floatingChat).toBeVisible();
    await floatingChat.click();

    const ordersDrawer = page.getByLabel('Meus Pedidos');
    await expect(ordersDrawer.getByText('Pedido #4321')).toBeVisible();
    await expect(ordersDrawer.getByText(/1x Pizza Margherita/)).toBeVisible();

    await ordersDrawer.getByRole('button', { name: 'Chat & Status' }).click();
    const inlineChat = page.locator('#inline-order-chat-panel');
    await expect(inlineChat.getByText('Pedido #4321')).toBeVisible();
    await expect(inlineChat.getByText('Em preparo').first()).toBeVisible();
    await expect(inlineChat.getByText('Pedido recebido pelo restaurante.')).toBeVisible();

    const customerInput = inlineChat.getByPlaceholder(/Escreva para o restaurante/i);
    await expect(customerInput).toBeVisible();
    await customerInput.fill('Por favor enviar talheres descartáveis');

    const sendButton = inlineChat.getByRole('button', { name: 'Enviar mensagem' });
    await sendButton.click();

    await expect(inlineChat.getByText('Por favor enviar talheres descartáveis')).toBeVisible();
  });

  test('caixa visualiza notificação de conversa, abre drawer e responde ao cliente', async ({
    page,
  }) => {
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

    await page.goto('/?view=caixa');

    const conversasBtn = page.getByRole('button', { name: /Conversas/i });
    await expect(conversasBtn).toBeVisible();
    await expect(conversasBtn.getByRole("status")).toHaveText(/[1-9]/);

    await conversasBtn.click();
    if ((page.viewportSize()?.width || 0) > 768) {
      await page.locator('#cashier-chat-overlay').click({ position: { x: 4, y: 100 } });
      await expect(page.locator('#cashier-chat-panel')).toHaveCount(0);
      await conversasBtn.click();
    }

    const convCard = page.getByRole('button', { name: /Pedido #4321/i });
    await expect(convCard).toBeVisible();
    await expect(convCard).toContainText('Ana Teste');

    await convCard.click();

    await expect(page.locator('div.rounded-2xl').filter({ hasText: 'Por favor enviar talheres descartáveis' })).toBeVisible();

    const staffInput = page.getByPlaceholder(/Responder ao cliente/i);
    await expect(staffInput).toBeVisible();
    await staffInput.fill('Confirmado! Talheres descartáveis adicionados ao pedido.');

    const replyButton = page.getByTitle(/Enviar resposta/i);
    await replyButton.click();

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