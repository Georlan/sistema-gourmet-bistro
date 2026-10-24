import { chromium } from 'playwright';
import path from 'path';

const OUT_DIR = '/home/testuser/.gemini/antigravity/brain/76b1291a-adf2-4293-a519-b621dfb7301a';
const APP_URL = 'http://localhost:3000/?view=garcom';
const NOW = new Date('2026-08-30T15:00:00.000Z');

const mockTables = [
  { id: 1, nome: 'Mesa 1', capacidade: 4, status: 'livre' },
  { id: 2, nome: 'Mesa 2', capacidade: 4, status: 'ocupada' },
  { id: 3, nome: 'Mesa 3', capacidade: 4, status: 'ocupada' },
  { id: 4, nome: 'Mesa 4', capacidade: 2, status: 'ocupada' },
  { id: 5, nome: 'Varanda Nobre', capacidade: 6, status: 'livre' },
  { id: 6, nome: 'Mesa 6', capacidade: 2, status: 'ocupada' },
];

const mockOrders = [
  // Mesa 2: Ocupada normal (preparando)
  {
    id: 'check-mesa-2',
    restaurante_id: 99001,
    mesa_id: 2,
    garcom_id: 'waiter-phase7',
    criada_por: { nome: 'Garçom Teste' },
    tipo: 'Consumo no Local',
    numero_pedido: 102,
    fechada: false,
    valor_pago: 0,
    criado_em: new Date(NOW.getTime() - 10 * 60_000).toISOString(),
    status_comanda: null,
    itens: [
      {
        id: 'item-2-1',
        lancamento_id: 'launch-2-1',
        produto_id: 'prod-1',
        preco_unit: 45,
        status: 'preparando',
        pago: false,
        cliente_nome: 'Consumo Geral',
        produto: { id: 'prod-1', nome: 'Hambúrguer Gourmet', preco: 45, ativo: true },
      },
    ],
  },
  // Mesa 3: Ocupada com itens prontos
  {
    id: 'check-mesa-3',
    restaurante_id: 99001,
    mesa_id: 3,
    garcom_id: 'waiter-phase7',
    criada_por: { nome: 'Garçom Teste' },
    tipo: 'Consumo no Local',
    numero_pedido: 103,
    fechada: false,
    valor_pago: 0,
    criado_em: new Date(NOW.getTime() - 20 * 60_000).toISOString(),
    status_comanda: null,
    itens: [
      {
        id: 'item-3-1',
        lancamento_id: 'launch-3-1',
        produto_id: 'prod-2',
        preco_unit: 30,
        status: 'pronto',
        pago: false,
        cliente_nome: 'Consumo Geral',
        produto: { id: 'prod-2', nome: 'Porção Batata Frita', preco: 30, ativo: true },
      },
    ],
  },
  // Mesa 4: Mesclada para Mesa 2
  {
    id: 'check-mesa-4-merged',
    restaurante_id: 99001,
    mesa_id: 2,
    mesa_origem_id: 4,
    garcom_id: 'waiter-phase7',
    criada_por: { nome: 'Garçom Teste' },
    tipo: 'Consumo no Local',
    numero_pedido: 104,
    fechada: false,
    valor_pago: 0,
    criado_em: new Date(NOW.getTime() - 15 * 60_000).toISOString(),
    status_comanda: null,
    itens: [
      {
        id: 'item-4-1',
        lancamento_id: 'launch-4-1',
        produto_id: 'prod-3',
        preco_unit: 25,
        status: 'entregue',
        pago: false,
        cliente_nome: 'Consumo Geral',
        produto: { id: 'prod-3', nome: 'Sobremesa Pudim', preco: 25, ativo: true },
      },
    ],
  },
  // Mesa 6: Aguardando Pagamento
  {
    id: 'check-mesa-6',
    restaurante_id: 99001,
    mesa_id: 6,
    garcom_id: 'waiter-phase7',
    criada_por: { nome: 'Garçom Teste' },
    tipo: 'Consumo no Local',
    numero_pedido: 106,
    fechada: false,
    valor_pago: 0,
    criado_em: new Date(NOW.getTime() - 35 * 60_000).toISOString(),
    status_comanda: 'aguardando_pagamento',
    itens: [
      {
        id: 'item-6-1',
        lancamento_id: 'launch-6-1',
        produto_id: 'prod-1',
        preco_unit: 45,
        status: 'entregue',
        pago: false,
        cliente_nome: 'Consumo Geral',
        produto: { id: 'prod-1', nome: 'Hambúrguer Gourmet', preco: 45, ativo: true },
      },
      {
        id: 'item-6-2',
        lancamento_id: 'launch-6-2',
        produto_id: 'prod-2',
        preco_unit: 30,
        status: 'entregue',
        pago: false,
        cliente_nome: 'Consumo Geral',
        produto: { id: 'prod-2', nome: 'Porção Batata Frita', preco: 30, ativo: true },
      },
    ],
  },
];

async function setupPageRoutes(page, theme = 'dark', textSize = 'padrao') {
  page.on('console', msg => {
    if (msg.type() === 'error') console.log(`[Browser ERROR] ${msg.text()}`);
  });
  page.on('pageerror', err => console.log(`[Page ERROR] ${err.message}`));

  await page.clock.setFixedTime(NOW);
  await page.addInitScript(({ theme, textSize }) => {
    sessionStorage.setItem('koma_waiter_token', 'waiter-wave1-test-token');
    sessionStorage.setItem('koma_active_operational_portal', 'garcom');
    sessionStorage.setItem('koma_waiter_id', 'waiter-phase7');
    sessionStorage.setItem('koma_waiter_name', 'Garçom KÔMA');
    sessionStorage.setItem('koma_user_role', 'garcom');
    sessionStorage.setItem('koma_restaurante_id', '99001');
    localStorage.setItem('@koma:theme', theme);
    localStorage.setItem('koma_font_size', textSize);
    localStorage.setItem('koma_waiter_drafts_v1_99001', JSON.stringify({
      'draft-mesa-1': {
        draftId: 'draft-mesa-1',
        tableId: 1,
        tableName: 'Mesa 1',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        items: [
          {
            draftItemId: 'di-1',
            productId: 'prod-1',
            productName: 'Hambúrguer Gourmet',
            unitPrice: 45,
            quantity: 1,
            selectedChoices: [],
            destination: 'COZINHA',
          }
        ],
        destinationSummaries: { COZINHA: 1 },
      }
    }));
  }, { theme, textSize });

  await page.routeWebSocket(/\/ws\//, socket => {
    socket.onMessage(() => {});
  });

  await page.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.port === '3000' && (url.pathname.startsWith('/src') || url.pathname.startsWith('/@') || url.pathname.startsWith('/node_modules') || url.pathname === '/' || url.pathname === '/favicon.ico' || url.pathname.includes('.'))) {
      await route.continue();
      return;
    }

    const pathname = url.pathname;
    const method = request.method();

    if (method === 'GET' && pathname === '/mesas/') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mockTables) });
    } else if (method === 'GET' && pathname === '/comandas/detalhes/todos') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mockOrders) });
    } else if (method === 'GET' && pathname.startsWith('/comandas/check-')) {
      const order = mockOrders.find(o => o.id === pathname.split('/')[2]);
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(order || mockOrders[0]) });
    } else if (method === 'GET' && pathname.startsWith('/atendimentos/mesas/')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ familias: [] }) });
    } else if (method === 'GET' && (pathname === '/produtos/catalogo' || pathname === '/produtos/categorias')) {
      if (pathname === '/produtos/categorias') {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ id: 'cat-1', nome: 'Geral', destino_impressao: 'COZINHA' }]) });
      } else {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            categorias: [{ id: 'cat-1', nome: 'Geral', destino_impressao: 'COZINHA' }],
            produtos: [
              { id: 'prod-1', nome: 'Hambúrguer Gourmet', preco: 45, ativo: true, categoria_id: 'cat-1' },
              { id: 'prod-2', nome: 'Porção Batata Frita', preco: 30, ativo: true, categoria_id: 'cat-1' },
              { id: 'prod-3', nome: 'Sobremesa Pudim', preco: 25, ativo: true, categoria_id: 'cat-1' },
            ],
          }),
        });
      }
    } else if (method === 'GET' && pathname === '/caixa/configuracoes') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          taxa_servico_ativa: false,
          taxa_servico_padrao: 0,
          perm_garcom_status: true,
          perm_garcom_print: true,
          perm_garcom_fechar: false,
          perm_garcom_editar: true,
          perm_garcom_cancelar_item: true,
          perm_garcom_transferir_mesa: true,
          perm_garcom_transferir_item: true,
          perm_garcom_delivery: false,
        }),
      });
    } else if (method === 'GET' && pathname === '/caixa/pagamentos/pendentes') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    } else if (url.port === '3000') {
      await route.continue();
    } else {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    }
  });
}

async function main() {
  console.log('Starting comprehensive screenshot captures of corrected UI...');
  const browser = await chromium.launch({ headless: true });

  // 1. 320x568 Ultra-narrow (iPhone SE 1st gen)
  {
    console.log('Capturing 320x568 Mobile Dark...');
    const context = await browser.newContext({
      viewport: { width: 320, height: 568 },
      deviceScaleFactor: 2,
      colorScheme: 'dark',
    });
    const page = await context.newPage();
    await setupPageRoutes(page, 'dark', 'padrao');
    await page.goto(APP_URL);
    await page.waitForSelector('#mesa-card-1', { timeout: 10000 });
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(OUT_DIR, 'waiter-corrected-320-dark.png') });
    await context.close();
  }

  // 2. 360x780 Mobile Dark (Standard Android)
  {
    console.log('Capturing 360x780 Mobile Dark (2 columns)...');
    const context = await browser.newContext({
      viewport: { width: 360, height: 780 },
      deviceScaleFactor: 2,
      colorScheme: 'dark',
    });
    const page = await context.newPage();
    await setupPageRoutes(page, 'dark', 'padrao');
    await page.goto(APP_URL);
    await page.waitForSelector('#mesa-card-1', { timeout: 10000 });
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(OUT_DIR, 'waiter-corrected-360-dark.png') });
    await context.close();
  }

  // 3. 390x844 Mobile Dark (iPhone 12/13/14)
  {
    console.log('Capturing 390x844 Mobile Dark...');
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      colorScheme: 'dark',
    });
    const page = await context.newPage();
    await setupPageRoutes(page, 'dark', 'padrao');
    await page.goto(APP_URL);
    await page.waitForSelector('#mesa-card-1', { timeout: 10000 });
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(OUT_DIR, 'waiter-corrected-390-dark.png') });
    await context.close();
  }

  // 4. 390x844 Mobile Light (iPhone 12/13/14)
  {
    console.log('Capturing 390x844 Mobile Light...');
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      colorScheme: 'light',
    });
    const page = await context.newPage();
    await setupPageRoutes(page, 'light', 'padrao');
    await page.goto(APP_URL);
    await page.waitForSelector('#mesa-card-1', { timeout: 10000 });
    await page.evaluate(() => {
      document.documentElement.setAttribute('data-koma-theme', 'light');
      document.documentElement.classList.remove('dark');
    });
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(OUT_DIR, 'waiter-corrected-390-light.png') });
    await context.close();
  }

  // 5. 430x932 Mobile Dark (iPhone 14/15/16 Pro Max)
  {
    console.log('Capturing 430x932 Mobile Dark...');
    const context = await browser.newContext({
      viewport: { width: 430, height: 932 },
      deviceScaleFactor: 2,
      colorScheme: 'dark',
    });
    const page = await context.newPage();
    await setupPageRoutes(page, 'dark', 'padrao');
    await page.goto(APP_URL);
    await page.waitForSelector('#mesa-card-1', { timeout: 10000 });
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(OUT_DIR, 'waiter-corrected-430-dark.png') });
    await context.close();
  }

  // 6. Tablet (768x1024) Dark
  {
    console.log('Capturing 768x1024 Tablet Dark...');
    const context = await browser.newContext({
      viewport: { width: 768, height: 1024 },
      deviceScaleFactor: 2,
      colorScheme: 'dark',
    });
    const page = await context.newPage();
    await setupPageRoutes(page, 'dark', 'padrao');
    await page.goto(APP_URL);
    await page.waitForSelector('#mesa-card-1', { timeout: 10000 });
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(OUT_DIR, 'waiter-corrected-tablet-dark.png') });
    await context.close();
  }

  // 7. Click card body on Mesa 2 (occupied) -> opens Consumo directly
  {
    console.log('Capturing 1-Touch to Consumo (Mesa 2 card body)...');
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      colorScheme: 'dark',
    });
    const page = await context.newPage();
    await setupPageRoutes(page, 'dark', 'padrao');
    await page.goto(APP_URL);
    await page.waitForSelector('#mesa-card-2', { timeout: 10000 });
    await page.waitForTimeout(400);

    // Click card body
    await page.locator('#mesa-card-2').click({ position: { x: 50, y: 30 } });
    await page.waitForSelector('#tab-consumo-btn[aria-selected="true"]', { timeout: 5000 });
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(OUT_DIR, 'waiter-corrected-action-consumo.png') });
    await context.close();
  }

  // 8. Click "+ Lançar" button on Mesa 2 (occupied) -> opens Pedido/Lançamento directly
  {
    console.log('Capturing 1-Touch to Lançamento (Mesa 2 + Lançar button)...');
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      colorScheme: 'dark',
    });
    const page = await context.newPage();
    await setupPageRoutes(page, 'dark', 'padrao');
    await page.goto(APP_URL);
    await page.waitForSelector('#mesa-card-2', { timeout: 10000 });
    await page.waitForTimeout(400);

    // Click "+ Lançar"
    const orderBtn = page.locator('#mesa-card-launch-2');
    await orderBtn.click();
    await page.waitForSelector('#tab-lancamento-btn[aria-selected="true"]', { timeout: 5000 });
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(OUT_DIR, 'waiter-corrected-action-lancamento.png') });
    await context.close();
  }

  await browser.close();
  console.log('All screenshots captured successfully!');
}

main().catch(err => {
  console.error('Error capturing screenshots:', err);
  process.exit(1);
});
