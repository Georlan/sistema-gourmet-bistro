import { expect, Page, test } from '@playwright/test';

const API_ORIGIN = 'http://127.0.0.1:8000';
const DESKTOP_BREAKPOINT = 769;

const tables = Array.from({ length: 10 }, (_, index) => ({
  id: index + 1,
  capacidade: 4,
  nome: `Mesa ${index + 1}`,
}));

// Mantém uma mesa livre para cobrir visualmente os dois estados do salão.
const commands = tables.slice(0, -1).map((table, index) => ({
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
    ...(index === 0 ? [{
      id: `item-ready-e2e-${table.id}`,
      produto_id: 'produto-pronto-e2e',
      preco_unit: 12,
      observacao: '',
      cliente_nome: 'Consumo Geral',
      status: 'pronto',
      pago: false,
    }] : []),
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
    else if (pathname === '/produtos/catalogo') body = {
      categorias: [
        { id: 'cat-pratos', nome: 'Pratos', destino_impressao: 'COZINHA' },
        { id: 'cat-bebidas', nome: 'Bebidas', destino_impressao: 'BAR' },
      ],
      produtos: [
        { id: '101', nome: 'Risoto da casa', preco: 42, categoria_id: 'cat-pratos', ativo: true },
        { id: '201', nome: 'Suco natural', preco: 12, categoria_id: 'cat-bebidas', ativo: false },
      ],
    };
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
    } else if (pathname === '/estoque/insumos') {
      body = [{ id: 'ins-arroz', nome: 'Arroz arbóreo', estoque_atual: 4, estoque_minimo: 5, estoque_maximo: 20, unidade_medida: 'kg', preco_medio_custo: 18 }];
    } else if (pathname === '/estoque/entradas') {
      body = [{ id: 'ent-1', numero_documento: 'NF-900', observacao: '', valor_total: 180, tipo_entrada: 'XML', created_at: new Date().toISOString(), distribuidor: { nome_fantasia: 'Distribuidora E2E' }, itens: [{ insumo_id: 'ins-arroz', quantidade: 10, unidade_medida: 'kg', custo_unitario: 18, subtotal: 180 }] }];
    } else if (pathname === '/estoque/movimentacoes') {
      body = [{ id: 1, insumo_id: 'ins-arroz', tipo: 'perda', quantidade: 1, saldo_anterior: 5, saldo_posterior: 4, custo_unitario: 18, motivo: 'Avaria', observacao: '', origem: 'manual', created_at: new Date().toISOString() }];
    } else if (pathname === '/estoque/fichas-tecnicas') {
      body = [
        { produto_id: '101', produto_nome: 'Risoto da casa', produto_ativo: true, itens: [{ insumo_id: 'ins-arroz', quantidade: 0.2, insumo: { id: 'ins-arroz', nome: 'Arroz arbóreo', estoque_atual: 4, estoque_minimo: 5, estoque_maximo: 20, unidade_medida: 'kg', preco_medio_custo: 18 } }] },
        { produto_id: '201', produto_nome: 'Suco natural', produto_ativo: false, itens: [] },
      ];
    } else if (pathname === '/estoque/notas' || pathname === '/estoque/contagens' || pathname === '/estoque/sugestoes') {
      body = [];
    } else if (pathname === '/estoque/distribuidores') {
      body = [{ id: 'dist-1', nome_fantasia: 'Distribuidora E2E', razao_social: 'Distribuidora E2E Ltda.', cnpj: '00.000.000/0001-00', lead_time_dias: 2 }];
    } else if (pathname === '/fidelidade/clientes') {
      body = [{ id: 'cli-1', nome: 'Cliente E2E', telefone: '85999999999', saldo_pontos: 25, saldo_cashback: 0 }];
    } else if (pathname === '/fidelidade/config') {
      body = { ativo: true, tipo_recompensa: 'PONTOS', taxa_conversao: 1, valor_ponto_em_dinheiro: 0.05 };
    } else if (pathname === '/relatorios/visao-geral') {
      body = {
        faturamento_total: 870,
        vendas_brutas: 900,
        estornos: 30,
        total_pedidos: 18,
        ticket_medio: 48.33,
        clientes_ativos: 12,
        meta_mensal: 12000,
        meta_realizada: 5300,
        meta_restante: 6700,
        meta_percentual: 44.2,
        meta_projecao: 10100,
        meta_media_diaria_necessaria: 305,
        vendas_por_dia: [{ data: '2026-08-25', quantidade_pedidos: 18, total: 870 }],
        horarios_pico: [{ hora: '20h', total_pedidos: 18, faturamento: 870 }],
        comparativo_anterior: { tem_base_anterior: true, faturamento_anterior: 725, variacao_faturamento_pct: 20, pedidos_anteriores: 15, variacao_pedidos_pct: 20 },
      };
    } else if (pathname === '/comandas/estatisticas/geral') {
      body = {
        faturamento: 870,
        faturamento_hoje: 220,
        vendas_brutas: 900,
        estornos: 30,
        vendas_liquidas: 870,
        total_pedidos: 18,
        ticket_medio: 48.33,
        breakdown_bruto: { pix: 300, cartao: 500, dinheiro: 100 },
        breakdown_estornos: { pix: 0, cartao: 30, dinheiro: 0 },
        breakdown_pagamentos: { pix: 300, cartao: 470, dinheiro: 100 },
        dia_operacional_inicio: '2026-07-26',
        dia_operacional_fim: '2026-08-25',
        comparativo_anterior: { tem_base_anterior: true, recebido_anterior: 725, variacao_recebido_pct: 20, contas_anteriores: 15, variacao_contas_pct: 20 },
      };
    } else if (pathname === '/relatorios/produtos') {
      body = [{ ranking: 1, produto_id: '101', produto_nome: 'Risoto da casa', categoria_nome: 'Pratos', quantidade_consumida: 8, valor_consumido: 336, preco_medio_item: 42, natureza_valor: 'consumo_operacional_nao_receita', ficha_tecnica_configurada: true, custo_unitario_estimado: 3.6, cmv_estimado: 28.8, margem_contribuicao_estimada: 307.2, margem_percentual_estimada: 91.4 }];
    } else if (pathname === '/relatorios/equipe/desempenho') {
      body = { taxa_servico_ativa: true, taxa_servico_padrao: 10, membros: [{ id: 'garcom-e2e', nome: 'Atendente E2E', email: 'atendente@koma.test', role: 'garcom', pedidos_atendidos: 18, faturamento: 870, ticket_medio: 48.33, comissao: 87, taxa_servico_usada: 10 }] };
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

async function seedReportSession(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('koma_caixa_token', 'playwright-e2e-token');
    localStorage.setItem('koma_caixa_id', 'caixa-e2e');
    localStorage.setItem('koma_caixa_name', 'Caixa E2E');
    localStorage.setItem('koma_caixa_role', 'caixa');
    localStorage.setItem('token', 'playwright-e2e-token');
    sessionStorage.setItem('koma_active_tab', 'relatorios');
    sessionStorage.setItem('koma_active_subtab', 'visao_geral');
  });
}

async function seedKitchenSession(page: Page) {
  await page.addInitScript(() => {
    const token = 'playwright-kitchen-token';
    const user = {
      id: 'cozinha-e2e',
      nome: 'Cozinha E2E',
      role: 'cozinha',
    };
    localStorage.setItem('koma_operator_session', JSON.stringify({
      token,
      user,
      expiresAt: Date.now() + 60_000,
    }));
    localStorage.setItem('koma_caixa_token', token);
    localStorage.setItem('koma_caixa_id', user.id);
    localStorage.setItem('koma_caixa_name', user.nome);
    localStorage.setItem('koma_caixa_role', user.role);
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

    const expandedSidebar = page.locator('.cashier-sidebar:visible');
    const expandedThemeButton = expandedSidebar.getByRole('button', { name: 'Alternar tema' });
    await expect(expandedThemeButton).toBeVisible();
    const themeBounds = await expandedThemeButton.evaluate(element => {
      const button = element.getBoundingClientRect();
      const sidebar = element.closest('.cashier-sidebar')?.getBoundingClientRect();
      return { buttonLeft: button.left, buttonRight: button.right, sidebarLeft: sidebar?.left ?? 0, sidebarRight: sidebar?.right ?? 0 };
    });
    expect(themeBounds.buttonLeft).toBeGreaterThanOrEqual(themeBounds.sidebarLeft - 1);
    expect(themeBounds.buttonRight).toBeLessThanOrEqual(themeBounds.sidebarRight + 1);

    await expandedThemeButton.click();
    await expect(page.locator('html')).toHaveAttribute('data-koma-theme', 'light');
    const pendingItemsWarning = page.getByText('Outro item continua em preparo.', { exact: true });
    await expect(pendingItemsWarning).toBeVisible();
    await expect.poll(() => pendingItemsWarning.evaluate(element => getComputedStyle(element).color)).toBe('rgb(146, 64, 14)');

    await page.getByRole('button', { name: 'Salão', exact: true }).click();
    const freeTableCard = page.locator('[data-table-status="free"]').first();
    const freeTableAction = freeTableCard.getByRole('button', { name: 'Abrir pedido' });
    const occupiedTableAction = page.locator('[data-table-status="occupied"]').first().getByRole('button', { name: 'Ver comanda' });
    await expect(freeTableCard).toBeVisible();
    await expect(freeTableAction).toBeVisible();
    await expect(occupiedTableAction).toBeVisible();
    await expect.poll(() => freeTableCard.evaluate(element => getComputedStyle(element).backgroundColor)).toBe('rgb(231, 245, 238)');
    await expect.poll(() => freeTableAction.evaluate(element => getComputedStyle(element).backgroundColor)).toBe('rgb(191, 234, 212)');
    await expect.poll(() => occupiedTableAction.evaluate(element => getComputedStyle(element).backgroundColor)).toBe('rgb(247, 188, 188)');

    await page.getByRole('button', { name: 'Recolher ou expandir menu' }).click();
    const collapsedSidebar = page.locator('.cashier-sidebar:visible');
    const compactLogo = collapsedSidebar.locator('.cashier-sidebar__logo-wrap--compact');
    await expect(compactLogo).toBeVisible();
    await expect(collapsedSidebar.locator('.cashier-sidebar__logo-wrap--expanded')).toBeHidden();
    await expect(compactLogo.locator('[data-koma-logo="icon"]')).toBeVisible();

    const logoBounds = await compactLogo.evaluate(element => {
      const logo = element.getBoundingClientRect();
      const sidebar = element.closest('.cashier-sidebar')?.getBoundingClientRect();
      return {
        logoWidth: logo.width,
        logoLeft: logo.left,
        logoRight: logo.right,
        sidebarLeft: sidebar?.left ?? 0,
        sidebarRight: sidebar?.right ?? 0,
      };
    });
    expect(logoBounds.logoWidth).toBeLessThanOrEqual(35);
    expect(logoBounds.logoLeft).toBeGreaterThanOrEqual(logoBounds.sidebarLeft - 1);
    expect(logoBounds.logoRight).toBeLessThanOrEqual(logoBounds.sidebarRight + 1);
    await expect(collapsedSidebar.getByRole('button', { name: 'Alternar tema' })).toBeVisible();
  }
});

test('Cozinha conclui preparo pela API operacional', async ({ page }) => {
  await mockCashierBackend(page);
  await seedKitchenSession(page);
  await page.goto('/?view=caixa');

  const finishButton = page.locator('#kitchen-finish-btn-item-e2e-1');
  await expect(finishButton).toBeVisible();

  const statusRequest = page.waitForRequest(request => {
    const url = new URL(request.url());
    return request.method() === 'PUT'
      && url.pathname === '/comandas/itens/item-e2e-1/status'
      && url.searchParams.get('status') === 'pronto';
  });

  await finishButton.click();
  await statusRequest;
});

test('áreas de gestão usam navegação consolidada sem listas redundantes', async ({ page }) => {
  const viewport = page.viewportSize();
  test.skip(!viewport || viewport.width < DESKTOP_BREAKPOINT, 'Fluxo coberto nas variações desktop.');

  await mockCashierBackend(page);
  await seedCashierSession(page);
  await page.goto('/?view=caixa');

  await page.getByRole('button', { name: 'Cardápio', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Produtos', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Categorias', exact: true })).toBeVisible();
  await expect(page.getByLabel('Buscar produtos')).toBeVisible();
  await expect(page.getByLabel('Filtrar produtos por categoria')).toBeVisible();
  await expect(page.getByLabel('Filtrar disponibilidade')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Nova categoria', exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Pratos', exact: true })).toHaveCount(0);

  await page.getByRole('button', { name: 'Categorias', exact: true }).click();
  await expect(page.getByLabel('Buscar categorias')).toBeVisible();
  await expect(page.getByLabel('Filtrar categorias por destino')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Nova categoria', exact: true })).toBeVisible();
  await expect(page.getByText('cat-pratos', { exact: true })).toHaveCount(0);

  await page.getByRole('button', { name: 'Estoque', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Ingredientes', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Histórico', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Inventário', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Fornecedores', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Entradas', exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Reposição pede atenção' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Fichas técnicas', exact: true })).toBeVisible();
  await expect(page.getByText('ID: ins-arroz', { exact: true })).toHaveCount(0);

  await page.getByRole('button', { name: 'Fichas técnicas', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Fichas técnicas', exact: true })).toBeVisible();
  await expect(page.getByText(/baixa e o estorno por cancelamento serão automáticos/i)).toBeVisible();
  await page.getByRole('button', { name: 'Fechar fichas técnicas' }).click();

  await page.getByRole('button', { name: 'Histórico', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Tudo que mudou em um só lugar' })).toBeVisible();
  await expect(page.getByLabel('Buscar no histórico de estoque')).toBeVisible();
  await expect(page.getByText('Distribuidora E2E · NF-900')).toBeVisible();
  await expect(page.getByText('Avaria')).toBeVisible();

  await page.getByRole('button', { name: 'Clientes', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Programa de Fidelidade', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Clientes em uma única lista' })).toBeVisible();
  await expect(page.getByLabel('Buscar clientes')).toBeVisible();
  await page.getByRole('button', { name: 'Programa de Fidelidade', exact: true }).click();
  await expect(page.getByText('Configuração do programa')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Ver pontos dos clientes' })).toBeVisible();
  await expect(page.getByRole('table')).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
});

test('Relatórios preservam uma leitura responsiva sem consultas legadas duplicadas', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', request => requests.push(new URL(request.url()).pathname));
  await mockCashierBackend(page);
  await seedReportSession(page);
  await page.goto('/?view=caixa');

  await expect(page.getByText('Pagamentos aprovados menos estornos', { exact: true })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  expect(requests.filter(path => path === '/relatorios/visao-geral')).toHaveLength(1);
  expect(requests.filter(path => path === '/garcons/relatorio')).toHaveLength(0);

  await page.getByRole('button', { name: 'Financeiro', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Recebimentos por meio' })).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await page.getByRole('button', { name: 'Produtos', exact: true }).click();
  await expect(page.getByText('Consumo não é faturamento.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Unidades', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Valor', exact: true })).toBeVisible();
  await expect(page.getByText('CMV estimado', { exact: true })).toBeVisible();
  expect(requests.filter(path => path === '/produtos/categorias')).toHaveLength(0);
  await expectNoHorizontalOverflow(page);

  await page.locator('#relatorios-subtab-equipe').click();
  await expect(page.getByText('Desempenho por Funcionário', { exact: true })).toBeVisible();
  await expect(page.getByText('Valor atribuído', { exact: true })).toBeVisible();
  expect(requests.filter(path => path === '/garcons/relatorio')).toHaveLength(0);
  await expectNoHorizontalOverflow(page);
});

test('estoque mantém banners, filtros e fichas técnicas utilizáveis em qualquer largura', async ({ page }) => {
  await mockCashierBackend(page);
  await seedCashierSession(page);
  await page.addInitScript(() => {
    sessionStorage.setItem('koma_active_tab', 'estoque');
    sessionStorage.setItem('koma_active_subtab', 'insumos');
  });
  await page.goto('/?view=caixa');

  const viewportWidth = page.viewportSize()?.width ?? 1024;
  if (viewportWidth > 768) {
    await expect(page.getByRole('heading', { name: 'Reposição pede atenção' })).toBeVisible();
  } else {
    // On compact screens the shared operational banner is intentionally hidden
    // so the primary stock actions remain above the fold.
    await expect(page.getByRole('heading', { name: 'Reposição pede atenção' })).toBeHidden();
  }
  await expect(page.getByLabel('Buscar ingredientes')).toBeVisible();
  await expect(page.getByLabel('Filtrar ingredientes por situação')).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await page.getByRole('button', { name: 'Fichas técnicas', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.getByRole('button', { name: 'Fechar fichas técnicas' }).click();

  await page.getByRole('button', { name: 'Histórico', exact: true }).click();
  if (viewportWidth > 768) {
    await expect(page.getByRole('heading', { name: 'Tudo que mudou em um só lugar' })).toBeVisible();
  } else {
    await expect(page.getByRole('heading', { name: 'Tudo que mudou em um só lugar' })).toBeHidden();
  }
  await expectNoHorizontalOverflow(page);

  await page.getByRole('button', { name: 'Inventário', exact: true }).click();
  if (viewportWidth > 768) {
    await expect(page.getByRole('heading', { name: 'Faça a primeira conferência' })).toBeVisible();
  } else {
    await expect(page.getByRole('heading', { name: 'Faça a primeira conferência' })).toBeHidden();
  }
  await expectNoHorizontalOverflow(page);

  await page.getByRole('button', { name: 'Fornecedores', exact: true }).click();
  if (viewportWidth > 768) {
    await expect(page.getByRole('heading', { name: 'Reposição mais previsível' })).toBeVisible();
  } else {
    await expect(page.getByRole('heading', { name: 'Reposição mais previsível' })).toBeHidden();
  }
  await expectNoHorizontalOverflow(page);
});
