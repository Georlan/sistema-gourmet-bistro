import { expect, Page, test } from '@playwright/test';

const API_ORIGIN = 'http://127.0.0.1:8000';

const basePublicMenuPayload = {
  restaurante: {
    id: 2,
    nome: 'Pizzeria Bella Italia',
    slug: 'bella-italia',
    logo_url: '',
    banner_url: '',
    subtitulo: 'Pizza artesanal no forno a lenha',
    sobre_nos: 'Pizzas artesanais preparadas na hora.',
    endereco: 'Av. Principal, 100 - Centro',
    google_maps_url: '',
    status_override: 'Forçado Aberto',
    socials: {
      whatsapp: '85999999999',
      instagram: 'bellaitalia',
    },
    horarios_funcionamento: [
      { days: 'Segunda a Domingo', hours: '18:00 - 23:00' },
    ],
    formas_pagamento_aceitas: ['Pix', 'Dinheiro', 'Cartão de crédito'],
    cor_primaria: '#00b894',
    cor_fundo: '#090a0f',
  },
  categorias: [
    { id: 10, nome: 'Pizzas & Massas' },
  ],
  produtos: [
    {
      id: 101,
      nome: 'Pizza Margherita',
      descricao: 'Molho de tomate, mussarela e manjericão fresco.',
      preco: 48,
      imagem_url: '',
      imagens_galeria: [],
      categoria_id: 10,
    },
  ],
};

type CapturedOrder = {
  restaurante_id?: number;
  cliente_nome?: string;
  cliente_telefone?: string;
  tipo_pedido?: string;
  taxa_entrega?: number;
  forma_pagamento?: string;
  forma_pagamento_detalhe?: string;
  endereco_entrega?: string;
  itens?: Array<{ produto_id?: string | number; quantidade?: number }>;
};

type BackendOptions = {
  statusOverride?: string;
  orderStatus?: string;
  orderClosed?: boolean;
  restaurant?: Partial<typeof basePublicMenuPayload.restaurante> & {
    delivery_ativo?: boolean;
    pagamento_online_ativo?: boolean;
    pedido_minimo?: number;
  };
};

async function mockPublicMenuBackend(
  page: Page,
  capturedOrders: CapturedOrder[],
  options: BackendOptions = {},
) {
  let otpRequests = 0;

  await page.route(`${API_ORIGIN}/**`, async route => {
    const request = route.request();
    const { pathname } = new URL(request.url());

    if (pathname === '/api/cardapio-digital/public') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ...basePublicMenuPayload,
          restaurante: {
            ...basePublicMenuPayload.restaurante,
            ...options.restaurant,
            status_override: options.statusOverride ?? basePublicMenuPayload.restaurante.status_override,
          },
        }),
      });
      return;
    }

    if (pathname.includes('/cardapio/clientes/otp/')) {
      otpRequests += 1;
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ detail: 'WhatsApp indisponível' }) });
      return;
    }

    if (pathname === '/cardapio/pedidos' && request.method() === 'POST') {
      const order = request.postDataJSON() as CapturedOrder;
      capturedOrders.push(order);
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          comanda_id: 'pedido-e2e',
          numero_pedido: 4321,
          total: 48 + Number(order.taxa_entrega || 0),
        }),
      });
      return;
    }

    if (pathname.startsWith('/cardapio/pedidos/') && pathname.endsWith('/status')) {
      const parts = pathname.split('/');
      const orderId = parts[3];
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: orderId,
          numero_pedido: orderId === 'pedido-e2e-2' ? 4322 : 4321,
          status: orderId === 'pedido-e2e-2' ? 'producao' : (options.orderStatus ?? 'pendente'),
          tipo: orderId === 'pedido-e2e-2' ? 'Delivery' : 'Retirada',
          total: orderId === 'pedido-e2e-2' ? 60 : 48,
          fechada: Boolean(options.orderClosed),
          itens: [{ id: 'item-e2e', nome: 'Pizza Margherita', quantidade: 1 }],
        }),
      });
      return;
    }

    if (pathname === '/cardapio/clientes/me') {
      await route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ detail: 'sem sessão' }) });
      return;
    }

    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) });
  });

  return { getOtpRequests: () => otpRequests };
}

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

async function openCart(page: Page) {
  if (!(await page.locator('#cart-drawer-container').isVisible().catch(() => false))) {
    await page.locator('#floating-cart-trigger').click();
  }
  await expect(page.getByRole('heading', { name: 'Sua sacola', exact: true })).toBeVisible();
}

test('visitante conclui retirada sem depender do WhatsApp em todos os tamanhos de tela', async ({ page }) => {
  const capturedOrders: CapturedOrder[] = [];
  const backend = await mockPublicMenuBackend(page, capturedOrders);

  await page.goto('/cardapio?restaurante_id=2');

  await expect(page.getByText('Pizzeria Bella Italia', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Pizza Margherita', { exact: true })).toBeVisible();
  await expect(page.getByPlaceholder('O que você quer pedir?')).toBeVisible();
  await expect(page.getByText('Pizzas & Massas', { exact: true }).first()).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await page.locator('#btn-fast-add-101').click();
  await openCart(page);

  await page.getByPlaceholder('Como devemos chamar você?').fill('Ana Teste');
  await page.getByPlaceholder('(00) 00000-0000').fill('85999999999');
  await page.getByRole('button', { name: /Retirada/ }).click();
  await page.getByRole('button', { name: 'Dinheiro', exact: true }).click();
  await page.getByRole('button', { name: 'Revisar pedido', exact: true }).click();

  await expect(page.getByRole('heading', { name: 'Revise e confirme', exact: true })).toBeVisible();
  const paymentSummary = page.getByRole('heading', { name: 'Pagamento escolhido', exact: true }).locator('..');
  await expect(paymentSummary.getByText('Você paga diretamente ao restaurante. Não há cobrança online nesta etapa.', { exact: true })).toBeVisible();
  await expect(paymentSummary.getByText(/^Dinheiro\s*· na retirada$/)).toBeVisible();
  await expect(page.getByText('Ana Teste', { exact: true })).toBeVisible();
  await expect(page.getByText(/R\$\s*48,00/).last()).toBeVisible();

  await page.getByRole('button', { name: 'Fazer pedido', exact: true }).click();

  await expect(page.getByText('Pedido recebido', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Pedido #4321', exact: true })).toBeVisible();
  await expect(page.getByText(/aguardando aceite/i)).toBeVisible();
  await page.getByRole('button', { name: 'Acompanhar pedido', exact: true }).click();
  await expect(page.getByText('Aguardando aceite', { exact: true })).toBeVisible();

  expect(capturedOrders).toHaveLength(1);
  expect(capturedOrders[0]).toMatchObject({
    restaurante_id: 2,
    cliente_nome: 'Ana Teste',
    cliente_telefone: '85999999999',
    tipo_pedido: 'retirada',
    taxa_entrega: 0,
    forma_pagamento: 'na_entrega',
    forma_pagamento_detalhe: 'dinheiro',
  });
  expect(capturedOrders[0].itens).toEqual([
    expect.objectContaining({ produto_id: '101', quantidade: 1 }),
  ]);
  expect(backend.getOtpRequests()).toBe(0);
  await expectNoHorizontalOverflow(page);
});

test('visitante consegue revisar delivery com endereço sem OTP', async ({ page }) => {
  const capturedOrders: CapturedOrder[] = [];
  const backend = await mockPublicMenuBackend(page, capturedOrders);

  await page.goto('/cardapio?restaurante_id=2');
  await page.locator('#btn-fast-add-101').click();
  await openCart(page);
  await page.getByPlaceholder('Como devemos chamar você?').fill('Bruno Cliente');
  await page.getByPlaceholder('(00) 00000-0000').fill('85988887777');
  const deliveryButton = page.getByRole('button', { name: /^Entrega\b/ });
  await deliveryButton.click();
  await expect(deliveryButton).toHaveAttribute('aria-pressed', 'true');
  await page.getByPlaceholder('Rua, número, complemento e bairro').fill('Rua das Flores, 123, Centro');
  await page.getByRole('button', { name: 'Revisar pedido', exact: true }).click();

  await expect(page.locator('#checkout-card').getByText('Rua das Flores, 123, Centro', { exact: true })).toBeVisible();
  await expect(page.getByText(/Taxa de entrega estimada/)).toBeVisible();
  await page.getByRole('button', { name: 'Fazer pedido', exact: true }).click();
  await expect(page.getByText('Pedido recebido', { exact: true })).toBeVisible();

  expect(capturedOrders).toHaveLength(1);
  expect(capturedOrders[0]).toMatchObject({
    cliente_nome: 'Bruno Cliente',
    cliente_telefone: '85988887777',
    tipo_pedido: 'delivery',
    taxa_entrega: 0,
    endereco_entrega: 'Rua das Flores, 123, Centro',
  });
  expect(backend.getOtpRequests()).toBe(0);
});

test('delivery pausado mantém retirada abaixo do mínimo e cartão presencial', async ({ page }) => {
  const capturedOrders: CapturedOrder[] = [];
  await mockPublicMenuBackend(page, capturedOrders, {
    restaurant: {
      delivery_ativo: false,
      pagamento_online_ativo: false,
      pedido_minimo: 100,
    },
  });

  await page.goto('/cardapio?restaurante_id=2');
  await expect(page.getByText('Somente retirada', { exact: true })).toBeVisible();
  await page.locator('#btn-fast-add-101').click();
  await openCart(page);

  const deliveryButton = page.getByRole('button', { name: /^Entrega\b/ });
  await expect(deliveryButton).toBeDisabled();
  await expect(deliveryButton).toContainText('Indisponível no momento');
  await expect(page.getByRole('button', { name: 'Pix', exact: true })).toHaveCount(0);
  await expect(page.getByText(/Faltam .* pedido mínimo/)).toHaveCount(0);

  await page.getByPlaceholder('Como devemos chamar você?').fill('Carla Retirada');
  await page.getByPlaceholder('(00) 00000-0000').fill('85977776666');
  await page.getByRole('button', { name: 'Cartão de crédito', exact: true }).click();
  await page.getByRole('button', { name: 'Revisar pedido', exact: true }).click();
  await expect(page.getByText(/^Cartão de crédito\s*· na retirada$/)).toBeVisible();
  await page.getByRole('button', { name: 'Fazer pedido', exact: true }).click();

  await expect(page.getByText('Pedido recebido', { exact: true })).toBeVisible();
  expect(capturedOrders).toHaveLength(1);
  expect(capturedOrders[0]).toMatchObject({
    tipo_pedido: 'retirada',
    taxa_entrega: 0,
    forma_pagamento: 'na_entrega',
    forma_pagamento_detalhe: 'cartao_credito',
  });
});

test('loja pausada mantém catálogo consultável e bloqueia criação de pedido', async ({ page }) => {
  const capturedOrders: CapturedOrder[] = [];
  await mockPublicMenuBackend(page, capturedOrders, { statusOverride: 'Forçado Fechado' });

  await page.goto('/cardapio?restaurante_id=2');
  await expect(page.getByText('Pedidos pausados.', { exact: false })).toBeVisible();
  await expect(page.getByText('Pizza Margherita', { exact: true })).toBeVisible();
  await page.locator('#btn-fast-add-101').click();
  await expect(page.getByText(/restaurante pausou novos pedidos/i)).toBeVisible();
  expect(capturedOrders).toHaveLength(0);
});

test('pedido recusado continua visível em vez de desaparecer', async ({ page }) => {
  const capturedOrders: CapturedOrder[] = [];
  await page.addInitScript(() => {
    localStorage.setItem('koma_active_order', JSON.stringify({
      id: 'pedido-e2e',
      numero_pedido: 4321,
      restaurante_id: 2,
      tipo: 'Retirada',
      total: 48,
      timestamp: Date.now(),
      idempotency_key: 'pedido-e2e-key',
    }));
  });
  await mockPublicMenuBackend(page, capturedOrders, { orderStatus: 'recusado', orderClosed: true });

  await page.goto('/cardapio?restaurante_id=2');
  await expect(page.getByText('Pedido não aceito', { exact: true })).toBeVisible();
  await expect(page.getByText(/não conseguiu aceitar este pedido/i)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Fazer novo pedido', exact: true })).toBeVisible();
  expect(capturedOrders).toHaveLength(0);
});

test('cliente consegue acompanhar múltiplos pedidos e alternar entre eles', async ({ page }) => {
  const capturedOrders: CapturedOrder[] = [];
  await page.addInitScript(() => {
    localStorage.setItem('koma_active_orders', JSON.stringify([
      {
        id: 'pedido-e2e-1',
        numero_pedido: 4321,
        restaurante_id: 2,
        tipo: 'Retirada',
        total: 48,
        timestamp: Date.now() - 5000,
        idempotency_key: 'key-1',
        status: 'pendente',
      },
      {
        id: 'pedido-e2e-2',
        numero_pedido: 4322,
        restaurante_id: 2,
        tipo: 'Delivery',
        total: 60,
        timestamp: Date.now(),
        idempotency_key: 'key-2',
        status: 'producao',
      },
    ]));
  });
  await mockPublicMenuBackend(page, capturedOrders);

  await page.goto('/cardapio?restaurante_id=2');

  // Banner com seletor de múltiplos pedidos
  await expect(page.locator('#active-order-banner')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Pedido #4322' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Pedido #4321' })).toBeVisible();

  // Alterna para o outro pedido
  await page.getByRole('button', { name: 'Pedido #4321' }).click();
  await expect(page.getByRole('heading', { name: 'Aguardando aceite' })).toBeVisible();

  // Abre a gaveta de Meus Pedidos pelo header
  await page.locator('#btn-my-orders-header').click();
  await expect(page.locator('#orders-drawer-panel')).toBeVisible();
  await expect(page.getByText('Meus Pedidos', { exact: true })).toBeVisible();
  await expect(page.getByText('Em andamento (2)')).toBeVisible();
});
