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
    socials: { whatsapp: '85999999999', instagram: 'bellaitalia' },
    horarios_funcionamento: [{ days: 'Segunda a Domingo', hours: '18:00 - 23:00' }],
    formas_pagamento_aceitas: ['Pix', 'Dinheiro'],
    cor_primaria: '#00b894',
    cor_fundo: '#090a0f',
  },
  categorias: [{ id: 10, nome: 'Pizzas' }],
  produtos: [{
    id: 101,
    nome: 'Pizza Margherita',
    descricao: 'Molho de tomate, mussarela e manjericão.',
    preco: 48,
    imagem_url: '',
    imagens_galeria: [],
    categoria_id: 10,
  }],
};

const storedOrder = {
  id: 'pedido-chat-e2e',
  numero_pedido: 4321,
  timestamp: Date.now(),
  restaurante_id: 2,
  tipo: 'Retirada',
  total: 48,
  idempotency_key: '',
  status: 'producao',
  tracking_token: 'tok_chat_viewport_e2e_123456789',
};

async function mockBackend(page: Page) {
  await page.route(`${API_ORIGIN}/**`, async route => {
    const request = route.request();
    const { pathname } = new URL(request.url());

    if (pathname === '/api/cardapio-digital/public') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(publicMenuPayload) });
      return;
    }

    if (pathname === '/cardapio/clientes/me') {
      await route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ detail: 'sem sessão' }) });
      return;
    }

    if (pathname.endsWith('/messages')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          { id: 'msg-1', sender_type: 'staff', body: 'Seu pedido já está em preparo.', created_at: '2026-09-10T06:00:00Z' },
        ]),
      });
      return;
    }

    if (pathname.endsWith('/read') && request.method() === 'POST') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'ok' }) });
      return;
    }

    if (pathname.endsWith('/events')) {
      await route.fulfill({ status: 200, contentType: 'text/event-stream', body: ': ready\n\n' });
      return;
    }

    if (pathname.includes('/api/cardapio/pedidos/acompanhar/')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          status: 'producao',
          tipo: 'Retirada',
          conversa: { unread_count: 1, can_chat: true, closed_at: null },
          state: {
            status: 'preparing',
            phase: 'preparing',
            label: 'Em preparo',
            fulfillment: 'pickup',
            terminal: false,
            rejected: false,
            can_chat: true,
            can_cancel: false,
            progress_step: 2,
            progress_total: 4,
          },
        }),
      });
      return;
    }

    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) });
  });
}

async function seedOrder(page: Page) {
  await page.addInitScript(order => {
    window.sessionStorage.setItem('koma_active_orders', JSON.stringify([order]));
  }, storedOrder);
}

async function expectInsideViewport(page: Page, selector: string) {
  const box = await page.locator(selector).boundingBox();
  expect(box).not.toBeNull();
  const viewport = page.viewportSize();
  expect(viewport).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport!.width + 1);
}

for (const viewport of [
  { name: 'desktop', width: 1280, height: 800 },
  { name: 'mobile-390', width: 390, height: 844 },
  { name: 'mobile-320', width: 320, height: 720 },
]) {
  test(`Pedido/Chat permanece utilizável e sem overflow em ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await mockBackend(page);
    await seedOrder(page);

    await page.goto('/cardapio?restaurante_id=2');

    const trigger = page.locator('#floating-order-chat-trigger');
    await expect(trigger).toBeVisible();
    await expect(trigger).toContainText('Pedido #4321');
    await expect(trigger).toContainText('Nova mensagem');
    await expectInsideViewport(page, '#floating-order-chat-trigger');

    const pageOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(pageOverflow).toBeLessThanOrEqual(1);

    await trigger.click();
    const drawer = page.locator('#orders-drawer-panel');
    await expect(drawer).toBeVisible();
    await expectInsideViewport(page, '#orders-drawer-panel');
    await expect(page.locator('#inline-order-chat-panel .koma-public-icon')).toBeVisible();
    await expect(page.getByText('Chat e acompanhamento sem sair do cardápio')).toBeVisible();

    const drawerOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(drawerOverflow).toBeLessThanOrEqual(1);
  });
}
