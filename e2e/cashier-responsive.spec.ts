import { expect, Page, test } from '@playwright/test';

import { mockCashierBackend, seedCashierSession, commands, DESKTOP_BREAKPOINT } from './fixtures/cashier';

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

async function seedTeamSession(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('koma_caixa_token', 'playwright-e2e-token');
    localStorage.setItem('koma_caixa_id', 'caixa-e2e');
    localStorage.setItem('koma_caixa_name', 'Caixa E2E');
    localStorage.setItem('koma_caixa_role', 'caixa');
    localStorage.setItem('token', 'playwright-e2e-token');
    sessionStorage.setItem('koma_active_tab', 'permissoes_cargos');
    sessionStorage.setItem('koma_active_subtab', 'pessoas');
  });
}

async function seedCatalogSession(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('koma_caixa_token', 'playwright-e2e-token');
    localStorage.setItem('koma_caixa_id', 'caixa-e2e');
    localStorage.setItem('koma_caixa_name', 'Caixa E2E');
    localStorage.setItem('koma_caixa_role', 'caixa');
    localStorage.setItem('token', 'playwright-e2e-token');
    sessionStorage.setItem('koma_active_tab', 'cardapio');
    sessionStorage.setItem('koma_active_subtab', 'produtos');
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
  await expect(page.getByRole('button', { name: 'Preparo e impressão', exact: true })).toBeVisible();
  await expect(page.getByLabel('Buscar produtos')).toBeVisible();
  await expect(page.getByLabel('Categorias do cardápio')).toBeVisible();
  await expect(page.getByLabel('Filtrar por disponibilidade')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Nova categoria', exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Pratos', exact: true })).toHaveCount(0);

  await page.getByRole('button', { name: 'Preparo e impressão', exact: true }).click();
  await expect(page.getByLabel('Buscar categorias')).toBeVisible();
  await expect(page.getByLabel('Rotas de impressão')).toBeVisible();
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

test('Cardápio mantém filtros e ações principais fáceis em qualquer largura', async ({ page }) => {
  await mockCashierBackend(page);
  await seedCatalogSession(page);
  await page.goto('/?view=caixa');

  await expect(page.getByRole('button', { name: 'Produtos', exact: true })).toBeVisible();
  await expect(page.getByLabel('Buscar produtos')).toBeVisible();
  await expect(page.getByLabel('Categorias do cardápio')).toBeVisible();
  await expect(page.getByLabel('Filtrar por disponibilidade')).toBeVisible();
  await expect(page.getByText('Risoto da casa', { exact: true })).toBeVisible();
  await expect(page.getByText('Suco natural', { exact: true })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.getByLabel('Selecionar os 2 exibidos').check();
  await expect(page.getByText('2 produtos selecionados', { exact: true })).toBeVisible();
  const batchAvailabilityRequest = page.waitForRequest(request => (
    request.method() === 'PATCH'
    && new URL(request.url()).pathname === '/produtos/disponibilidade'
  ));
  await page.locator('section').filter({ hasText: '2 produtos selecionados' }).getByRole('button', { name: 'Pausar venda', exact: true }).click();
  await batchAvailabilityRequest;

  await page.getByRole('button', { name: 'Novo produto', exact: true }).click();
  const productDialog = page.getByRole('dialog', { name: 'Novo produto' });
  await expect(productDialog).toBeVisible();
  await expect(productDialog.getByLabel('Código do produto')).toHaveValue('202');
  await expect(productDialog.getByLabel('Nome do produto')).toBeVisible();
  await expect(productDialog.getByLabel('Preço de venda')).toBeVisible();
  await expect(productDialog.getByLabel('Categoria', { exact: true })).toHaveValue('cat-pratos');
  await expect(productDialog.getByText('Fotos do produto')).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await productDialog.getByRole('button', { name: 'Fechar' }).click();

  await page.getByRole('button', { name: 'Preparo e impressão', exact: true }).click();
  await expect(page.getByLabel('Buscar categorias')).toBeVisible();
  await expect(page.getByLabel('Rotas de impressão')).toBeVisible();
  const routeRequest = page.waitForRequest(request => (
    request.method() === 'PUT'
    && new URL(request.url()).pathname === '/produtos/categorias/cat-pratos'
  ));
  const printRouteGroup = page.getByRole('group', { name: 'Escolher impressão para Pratos' });
  await expect(printRouteGroup.getByRole('button', { name: 'Imprimir na cozinha para Pratos' })).toHaveAttribute('aria-pressed', 'true');
  await printRouteGroup.getByRole('button', { name: 'Não imprimir para Pratos' }).click();
  await routeRequest;
  await page.locator('article').filter({ has: page.getByRole('heading', { name: 'Pratos', exact: true }) }).getByRole('button', { name: 'Ver 1 produto', exact: true }).click();
  await expect(page.getByRole('button', { name: /^Pratos 1/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('Risoto da casa', { exact: true })).toBeVisible();
  await expect(page.getByText('Suco natural', { exact: true })).toHaveCount(0);
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

test('Equipe concentra convites e acessos sem funções ou consultas duplicadas', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', request => requests.push(new URL(request.url()).pathname));
  await mockCashierBackend(page);
  await seedTeamSession(page);
  await page.goto('/?view=caixa');

  await expect(page.getByLabel('Buscar pessoa')).toBeVisible();
  await expect(page.getByText('Administradora E2E', { exact: true })).toBeVisible();
  await expect(page.getByText('Garçom E2E', { exact: true })).toBeVisible();
  await expect(page.getByText('Convite E2E', { exact: true })).toBeVisible();
  await expect(page.getByText('Acesso ativo', { exact: true })).toHaveCount(2);
  await expect(page.getByText('Aguardando ativação', { exact: true })).toBeVisible();
  expect(requests.filter(path => path === '/caixa/funcionarios')).toHaveLength(1);

  await page.getByRole('button', { name: 'Convites 1', exact: true }).click();
  await expect(page.getByText('Convite E2E', { exact: true })).toBeVisible();
  await expect(page.getByText('Administradora E2E', { exact: true })).toHaveCount(0);

  await page.getByRole('button', { name: 'Convidar pessoa', exact: true }).click();
  const inviteDialog = page.getByRole('dialog', { name: 'Convidar para a equipe' });
  await expect(inviteDialog).toBeVisible();
  await expect(inviteDialog.getByText('Operador de caixa', { exact: true })).toBeVisible();
  await expect(inviteDialog.getByText('Entregador', { exact: true })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await inviteDialog.getByRole('button', { name: 'Fechar convite' }).click();

  await page.getByRole('button', { name: 'Funções e acessos', exact: true }).click();
  await expect(page.getByLabel('Funções e acessos')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Operador de caixa', exact: true })).toHaveCount(1);
  await expect(page.getByRole('heading', { name: 'Operador Caixa', exact: true })).toHaveCount(0);
  expect(requests.filter(path => path === '/relatorios/cargos-permissoes')).toHaveLength(1);
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
