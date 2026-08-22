import { expect, Page, test } from '@playwright/test';

const API_ORIGIN = 'http://127.0.0.1:8000';
const DESKTOP_BREAKPOINT = 769;

const tables = Array.from({ length: 10 }, (_, index) => ({
  id: index + 1,
  capacidade: 4,
  nome: `Mesa ${index + 1}`,
}));

const commands = tables.map((table, index) => ({
  id: `cmd-e2e-${table.id}`,
  restaurante_id: 99001,
  mesa_id: table.id,
  garcom_id: 'caixa-e2e',
  garcom_nome: 'Caixa E2E',
  tipo: 'Consumo no Local',
  numero_pedido: 700 + index,
  fechada: false,
  valor_pago: 0,
  criado_em: new Date(Date.now() - (index + 1) * 60_000).toISOString(),
  itens: [
    {
      id: `item-e2e-${table.id}`,
      produto_id: 'produto-e2e',
      preco_unit: 18.5,
      observacao: '',
      cliente_nome: 'Consumo Geral',
      status: 'preparando',
      pago: false,
    },
  ],
}));

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

const openShift = {
  id: 501,
  aberto_por_id: 'caixa-e2e',
  aberto_em: new Date().toISOString(),
  saldo_inicial: 100,
  status: 'aberto',
  movimentacoes: [],
  pagamentos: [],
};

async function mockCashierBackend(page: Page) {
  await page.route(`${API_ORIGIN}/**`, async route => {
    const { pathname } = new URL(route.request().url());
    let body: unknown = {};

    if (pathname === '/mesas/') body = tables;
    else if (pathname === '/comandas/detalhes/todos') body = commands;
    else if (pathname === '/produtos/catalogo') body = { produtos: [], categorias: [] };
    else if (pathname === '/caixa/configuracoes') body = cashierConfig;
    else if (pathname === '/caixa/turno/atual') body = openShift;
    else if (pathname === '/caixa/turno-atual/resumo') {
      body = {
        turno_id: openShift.id,
        status: 'aberto',
        operador_id: 'caixa-e2e',
        operador_nome: 'Caixa E2E',
        aberto_em: openShift.aberto_em,
        tempo_aberto_minutos: 15,
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
      };
    } else if (
      pathname === '/caixa/pagamentos/pendentes'
      || pathname === '/comandas/delivery/ativos'
      || pathname === '/comandas/motoboys/lista'
      || pathname === '/auth/smartpos/caixa/operacao'
      || pathname === '/caixa/funcionarios'
      || pathname === '/auth/usuarios'
    ) {
      body = [];
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });
  });
}

async function seedCashierSession(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('koma_caixa_token', 'playwright-e2e-token');
    localStorage.setItem('koma_caixa_id', 'caixa-e2e');
    localStorage.setItem('koma_caixa_name', 'Caixa E2E');
    localStorage.setItem('koma_caixa_role', 'caixa');
    localStorage.setItem('token', 'playwright-e2e-token');
    sessionStorage.setItem('koma_active_tab', 'operacao');
    sessionStorage.setItem('koma_active_subtab', 'pedidos');
  });
}

async function expectNoHorizontalOverflow(page: Page) {
  const dimensions = await page.evaluate(() => ({
    viewport: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    bodyWidth: document.body.scrollWidth,
  }));
  expect(dimensions.documentWidth).toBeLessThanOrEqual(dimensions.viewport + 1);
  expect(dimensions.bodyWidth).toBeLessThanOrEqual(dimensions.viewport + 1);
}

async function swipeDocumentUp(page: Page) {
  const client = await page.context().newCDPSession(page);
  const viewport = page.viewportSize();
  if (!viewport) throw new Error('Viewport indisponível para o gesto de toque.');
  const x = Math.round(viewport.width / 2);
  const startY = Math.round(viewport.height * 0.78);
  const endY = Math.round(viewport.height * 0.28);

  await client.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x, y: startY }],
  });
  for (let step = 1; step <= 6; step += 1) {
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x, y: startY + ((endY - startY) * step) / 6 }],
    });
  }
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchEnd',
    touchPoints: [],
  });
}

test('login continua utilizável sem overflow horizontal', async ({ page }) => {
  await page.goto('/?view=caixa');

  await expect(page.getByLabel('E-MAIL')).toBeVisible();
  await expect(page.getByLabel('Senha')).toBeVisible();
  await page.getByLabel('E-MAIL').fill('caixa@koma.test');
  await page.getByLabel('Senha').fill('senha-segura-e2e');
  await expect(page.getByRole('button', { name: 'Entrar' })).toBeEnabled();
  await expectNoHorizontalOverflow(page);
});

test('Caixa respeita scroll móvel e colunas simultâneas no desktop', async ({ page }) => {
  await mockCashierBackend(page);
  await seedCashierSession(page);
  await page.goto('/?view=caixa');

  const board = page.locator('.orders-board');
  await expect(board).toBeVisible();
  await expect(page.locator('.orders-card--salon')).toHaveCount(commands.length);
  await expectNoHorizontalOverflow(page);

  const viewport = page.viewportSize();
  if (!viewport) throw new Error('Viewport não configurado.');

  const enabledColumns = page.locator('.orders-column:not(.is-channel-disabled)');
  const stageTabs = page.getByRole('tablist', { name: 'Etapa dos pedidos' });

  if (viewport.width < DESKTOP_BREAKPOINT) {
    await expect(stageTabs).toBeVisible();
    await expect(page.getByRole('tab')).toHaveCount(3);
    await expect(page.getByRole('tab', { name: /Salão/ })).toHaveAttribute('aria-selected', 'true');

    const scrollBefore = await page.evaluate(() => window.scrollY);
    const scrollHeight = await page.evaluate(() => document.documentElement.scrollHeight);
    expect(scrollHeight).toBeGreaterThan(viewport.height);
    await swipeDocumentUp(page);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(scrollBefore);

    await page.getByRole('tab', { name: /Balcão/ }).tap();
    await expect(page.getByRole('tab', { name: /Balcão/ })).toHaveAttribute('aria-selected', 'true');
    await expect(enabledColumns.filter({ has: page.getByText('Balcão e delivery', { exact: true }) })).toBeVisible();
  } else {
    await expect(stageTabs).toBeHidden();
    await expect(enabledColumns).toHaveCount(3);
    for (const column of await enabledColumns.all()) {
      await expect(column).toBeVisible();
    }

    const positions = await enabledColumns.evaluateAll(columns => columns.map(column => {
      const rect = column.getBoundingClientRect();
      return { left: rect.left, right: rect.right, width: rect.width };
    }));
    expect(positions.every(position => position.width > 0)).toBe(true);
    expect(positions[0].right).toBeLessThanOrEqual(positions[1].left + 1);
    expect(positions[1].right).toBeLessThanOrEqual(positions[2].left + 1);
  }
});
