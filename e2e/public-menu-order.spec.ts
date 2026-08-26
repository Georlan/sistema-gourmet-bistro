import { expect, Page, test } from '@playwright/test';

const API_ORIGIN = 'http://127.0.0.1:8000';

const publicMenuPayload = {
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
    { id: 10, nome: 'Pizzas' },
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
  itens?: Array<{ produto_id?: string | number; quantidade?: number }>;
};

async function mockPublicMenuBackend(page: Page, capturedOrders: CapturedOrder[]) {
  await page.route(`${API_ORIGIN}/**`, async route => {
    const request = route.request();
    const { pathname } = new URL(request.url());

    if (pathname === '/api/cardapio-digital/public') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(publicMenuPayload),
      });
      return;
    }

    if (pathname === '/cardapio/clientes/otp/solicitar') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true }),
      });
      return;
    }

    if (pathname === '/cardapio/clientes/otp/verificar') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          access_token: 'customer-e2e-token',
          cliente: {
            id: 'cliente-e2e',
            nome: 'Ana Teste',
            telefone: '85999999999',
            endereco: '',
            saldo_pontos: 0,
            saldo_cashback: 0,
          },
        }),
      });
      return;
    }

    if (pathname === '/cardapio/pedidos' && request.method() === 'POST') {
      capturedOrders.push(request.postDataJSON() as CapturedOrder);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          comanda_id: 'pedido-e2e',
          numero_pedido: 4321,
          total: 48,
        }),
      });
      return;
    }

    if (pathname === '/cardapio/pedidos/pedido-e2e/status') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'pedido-e2e',
          numero_pedido: 4321,
          status: 'Recebido',
          tipo: 'retirada',
          total: 48,
          itens: [{ id: 'item-e2e', nome: 'Pizza Margherita', quantidade: 1 }],
        }),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({}),
    });
  });
}

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

test('cliente conclui pedido sem etapas duplicadas em todos os tamanhos de tela', async ({ page }) => {
  const capturedOrders: CapturedOrder[] = [];
  await mockPublicMenuBackend(page, capturedOrders);

  await page.goto('/cardapio?restaurante_id=2');

  await expect(page.getByText('Pizzeria Bella Italia', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Pizza Margherita', { exact: true })).toBeVisible();
  await expect(page.getByPlaceholder('O que você quer pedir?')).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await page.locator('#btn-fast-add-101').click();

  const viewportWidth = page.viewportSize()?.width ?? 0;
  if (viewportWidth >= 1024) {
    await expect(page.locator('#desktop-shopping-cart-sidebar')).toBeVisible();
    await page.getByRole('button', { name: 'Retirada Balcão', exact: true }).click();
    await page.getByRole('button', { name: 'Confirmar e Enviar Pedido', exact: true }).click();
  } else {
    await page.locator('#floating-cart-trigger').click();
    await expect(page.getByRole('heading', { name: 'Sua sacola', exact: true })).toBeVisible();
    await page.getByRole('button', { name: /Retirada/ }).click();
    await page.getByRole('button', { name: /Continuar com celular/ }).click();
  }

  await expect(page.getByRole('heading', { name: 'Continue com seu celular', exact: true })).toBeVisible();
  await page.getByPlaceholder('(00) 00000-0000').fill('85999999999');
  await page.getByRole('button', { name: 'Receber código', exact: true }).click();

  await expect(page.getByRole('heading', { name: 'Só falta confirmar', exact: true })).toBeVisible();
  await page.getByPlaceholder('000000').fill('123456');
  await page.getByPlaceholder('Seu nome').fill('Ana Teste');
  await page.getByRole('button', { name: 'Confirmar e continuar', exact: true }).click();

  if (viewportWidth >= 1024) {
    await page.getByRole('button', { name: 'Confirmar e Enviar Pedido', exact: true }).click();
  } else {
    await page.getByRole('button', { name: 'Revisar pedido', exact: true }).click();
  }

  await expect(page.getByRole('heading', { name: 'Revise e confirme', exact: true })).toBeVisible();
  await expect(page.getByText('Pagamento direto ao restaurante', { exact: true })).toBeVisible();
  await expect(page.getByText('Pix', { exact: true })).toBeVisible();
  await expect(page.getByText(/R\$\s*48,00/).last()).toBeVisible();

  await page.getByRole('button', { name: 'Fazer pedido', exact: true }).click();

  await expect(page.getByText('Pedido recebido', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Pedido #4321', exact: true })).toBeVisible();
  await expect(page.getByText(/R\$\s*48,00/).last()).toBeVisible();

  expect(capturedOrders).toHaveLength(1);
  expect(capturedOrders[0]).toMatchObject({
    restaurante_id: 2,
    cliente_nome: 'Ana Teste',
    cliente_telefone: '85999999999',
    tipo_pedido: 'retirada',
    taxa_entrega: 0,
  });
  expect(capturedOrders[0].itens).toEqual([
    expect.objectContaining({ produto_id: '101', quantidade: 1 }),
  ]);

  await expectNoHorizontalOverflow(page);
});
