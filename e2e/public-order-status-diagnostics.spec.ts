import { expect, Page, test } from '@playwright/test';

const API_ORIGIN = 'http://127.0.0.1:8000';

const publicMenuPayload = {
  restaurante: {
    id: 2,
    nome: 'Pizzeria Bella Italia',
    slug: 'bella-italia',
    logo_url: '',
    banner_url: '',
    subtitulo: 'Pizza artesanal',
    sobre_nos: '',
    endereco: 'Av. Principal, 100',
    google_maps_url: '',
    status_override: 'Forçado Aberto',
    socials: {},
    horarios_funcionamento: [],
    formas_pagamento_aceitas: ['Pix'],
    cor_primaria: '#00b894',
    cor_fundo: '#090a0f',
  },
  categorias: [{ id: 10, nome: 'Pizzas' }],
  produtos: [{
    id: 101,
    nome: 'Pizza Margherita',
    descricao: '',
    preco: 48,
    imagem_url: '',
    imagens_galeria: [],
    categoria_id: 10,
  }],
};

type OrderState = {
  status: string;
  fechada: boolean;
};

async function mockTrackingBackend(page: Page, state: OrderState) {
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

    if (pathname === '/cardapio/pedidos/pedido-diag/status') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'pedido-diag',
          numero_pedido: 4321,
          status: state.status,
          tipo: 'retirada',
          total: 48,
          fechada: state.fechada,
          criado_em: new Date().toISOString(),
          itens: [{ id: 'item-diag', nome: 'Pizza Margherita', quantidade: 1 }],
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

async function seedTrackedOrder(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('koma_active_order', JSON.stringify({
      id: 'pedido-diag',
      numero_pedido: '4321',
      timestamp: Date.now(),
      restaurante_id: 2,
      cliente_nome: 'Ana Teste',
      tipo: 'Retirada',
      total: 48,
      idempotency_key: 'diag-tracking-key-123456',
    }));
  });
}

test('diagnostico: acompanhamento depende de atualizacao manual para refletir mudanca do pedido', async ({ page }) => {
  const state: OrderState = { status: 'pendente', fechada: false };
  await seedTrackedOrder(page);
  await mockTrackingBackend(page, state);

  await page.goto('/cardapio?restaurante_id=2');

  const banner = page.locator('#active-order-banner');
  await expect(banner).toBeVisible();
  await expect(banner).toContainText('pendente');

  state.status = 'producao';
  await page.waitForTimeout(750);

  // O status do backend mudou, mas a tela pública não faz polling nem reage a
  // evento de pedido; o cliente continua vendo a versão anterior até atualizar.
  await expect(banner).toContainText('pendente');
  await expect(banner).not.toContainText('producao');

  await page.getByRole('button', { name: 'Atualizar', exact: true }).click();
  await expect(banner).toContainText('producao');
});

test('diagnostico: pedido recusado desaparece do acompanhamento em vez de explicar a recusa', async ({ page }) => {
  const state: OrderState = { status: 'pendente', fechada: false };
  await seedTrackedOrder(page);
  await mockTrackingBackend(page, state);

  await page.goto('/cardapio?restaurante_id=2');
  const banner = page.locator('#active-order-banner');
  await expect(banner).toBeVisible();

  state.status = 'recusado';
  state.fechada = true;
  await page.getByRole('button', { name: 'Atualizar', exact: true }).click();

  await expect(banner).toBeHidden();
  await expect(page.getByText(/pedido recusado/i)).toHaveCount(0);
});

test('diagnostico: CTA desktop promete enviar antes da etapa de revisao', async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 0) < 1024, 'Diagnóstico específico do carrinho desktop.');

  const state: OrderState = { status: 'pendente', fechada: false };
  await mockTrackingBackend(page, state);
  await page.goto('/cardapio?restaurante_id=2');

  await page.locator('#btn-fast-add-101').click();
  const misleadingCta = page.getByRole('button', { name: 'Confirmar e Enviar Pedido', exact: true });
  await expect(misleadingCta).toBeVisible();

  // Ainda não há sessão/OTP nem revisão final, portanto este botão não envia o
  // pedido apesar do rótulo afirmar que envia.
  await misleadingCta.click();
  await expect(page.getByRole('heading', { name: 'Continue com seu celular', exact: true })).toBeVisible();
});
