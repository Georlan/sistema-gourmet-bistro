import { expect, Page, test } from '@playwright/test';

// Characterization written against the pre-Fase-7 consumers. These are UI
// slices of a check, not a new pricing rule or a financial state machine.
const API_ORIGIN = 'http://127.0.0.1:8000';

type Scenario = {
  statuses?: string[];
  checkStatus?: 'aguardando_pagamento' | null;
  subtab?: 'pedidos' | 'mesas';
  sameLaunch?: boolean;
  printFails?: boolean;
  canonicalIdentity?: boolean;
};

async function openOperationalScenario(page: Page, scenario: Scenario = {}) {
  const createdAt = new Date(Date.now() - 12 * 60_000).toISOString();
  const statuses = scenario.statuses ?? ['preparando', 'pronto'];
  const items = statuses.map((status, index) => ({
    id: `item-phase7-${index + 1}`,
    lancamento_id: `launch-phase7-${scenario.sameLaunch ? 1 : index + 1}`,
    produto_id: `product-phase7-${index + 1}`,
    preco_unit: index === 0 ? 112 : 48,
    status,
    pago: false,
    cliente_nome: 'Consumo Geral',
    observacao: '',
    produto: {
      id: `product-phase7-${index + 1}`,
      nome: index === 0 ? 'Prato em preparo' : 'Prato da segunda rodada',
      preco: index === 0 ? 112 : 48,
      ativo: true,
    },
  }));
  const check = {
    id: 'check-phase7-24',
    restaurante_id: 99001,
    mesa_id: 7,
    garcom_id: 'cashier-phase7',
    criada_por: { nome: 'Operador Fase 7' },
    tipo: 'Consumo no Local',
    numero_pedido: 24,
    fechada: false,
    valor_pago: 0,
    criado_em: createdAt,
    status_comanda: scenario.checkStatus ?? null,
    lancamentos: [...new Set(items.map(item => item.lancamento_id))].map(id => ({
      id,
      display_number: scenario.canonicalIdentity ? ({ 'launch-phase7-1': '24-A', 'launch-phase7-2': '24-B' }[id]) : null,
      comanda_id: 'check-phase7-24',
      origem: 'garcom',
      timestamp: createdAt,
    })),
    itens: items,
  };
  const writes: { path: string; status: string | null }[] = [];
  const actions: { path: string; query: string; method: string; body: unknown }[] = [];

  await page.addInitScript(({ subtab }) => {
    localStorage.setItem('koma_caixa_token', 'phase7-fixture-token');
    localStorage.setItem('koma_caixa_id', 'cashier-phase7');
    localStorage.setItem('koma_caixa_name', 'Operador Fase 7');
    localStorage.setItem('koma_caixa_role', 'caixa');
    localStorage.setItem('token', 'phase7-fixture-token');
    sessionStorage.setItem('koma_active_tab', 'operacao');
    sessionStorage.setItem('koma_active_subtab', subtab);
  }, { subtab: scenario.subtab ?? 'pedidos' });

  await page.route(`${API_ORIGIN}/**`, async route => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(request.method())) {
      actions.push({
        path,
        query: url.search,
        method: request.method(),
        body: request.postData() ? request.postDataJSON() : null,
      });
    }
    let responseStatus = 200;
    let body: unknown = [];
    if (path === '/comandas/detalhes/todos') body = [check];
    else if (path === '/mesas/') body = [
      { id: 7, nome: 'Mesa 7', capacidade: 4, status: 'ocupada' },
      { id: 8, nome: 'Mesa 8', capacidade: 4, status: 'livre' },
    ];
    else if (path === '/produtos/catalogo') body = {
      categorias: [{ id: 'phase7-meals', nome: 'Pratos', destino_impressao: 'COZINHA' }],
      produtos: items.map(item => ({ ...item.produto, categoria_id: 'phase7-meals' })),
    };
    else if (path === '/caixa/configuracoes') body = {
      taxa_servico_ativa: false,
      taxa_servico_padrao: 0,
      perm_garcom_status: true,
      perm_garcom_print: true,
      perm_garcom_fechar: true,
      perm_garcom_editar: true,
    };
    else if (path === '/caixa/turno/atual') body = {
      id: 701,
      aberto_por_id: 'cashier-phase7',
      aberto_em: createdAt,
      saldo_inicial: 100,
      status: 'aberto',
      movimentacoes: [],
      pagamentos: [],
    };
    else if (path === '/caixa/turno-atual/resumo') body = {
      turno_id: 701,
      status: 'aberto',
      operador_id: 'cashier-phase7',
      operador_nome: 'Operador Fase 7',
      aberto_em: createdAt,
      tempo_aberto_minutos: 12,
      saldo_inicial: 100,
      total_vendas: 0,
      saldo_esperado_dinheiro: 100,
      atividades_recentes: [],
    };
    else if (path.startsWith('/comandas/itens/') && request.method() === 'PUT') {
      writes.push({ path, status: url.searchParams.get('status') });
      body = { ok: true };
    }
    else if (path === '/mesas/7/cancelar-itens' && request.method() === 'POST') {
      const selectedIds = request.postDataJSON().item_ids as string[];
      items.filter(item => selectedIds.includes(item.id)).forEach(item => { item.status = 'cancelado'; });
      body = { mesa_id: 7, itens_cancelados: selectedIds.length, mesa_liberada: false };
    }
    else if (path === '/mesas/7/cancelar-consumo' && request.method() === 'POST') {
      items.forEach(item => { item.status = 'cancelado'; });
      body = { mesa_id: 7, itens_cancelados: items.length, mesa_liberada: true };
    }
    else if (path === '/comandas/check-phase7-24/transferir/8' && request.method() === 'POST') {
      check.mesa_id = 8;
      body = { ok: true };
    }
    else if (path.endsWith('/imprimir-recibo') || path.endsWith('/reimprimir')) {
      responseStatus = scenario.printFails ? 500 : 200;
      body = scenario.printFails ? { detail: 'Impressão indisponível no cenário' } : { ok: true };
    }
    await route.fulfill({ status: responseStatus, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.goto('/?view=caixa');
  return { writes, actions };
}

async function showStage(page: Page, stage: 'Salão' | 'Concluir') {
  const stageTab = page.getByRole('tab', { name: new RegExp(stage) });
  if (await stageTab.isVisible()) await stageTab.click();
}

test('fatias da mesma Comanda preservam R$112 em preparo e R$48 pronto', async ({ page }) => {
  await openOperationalScenario(page, { sameLaunch: true });
  await expect(page.locator('.orders-board')).toBeVisible();
  const production = page.locator('.orders-card--salon');
  await expect(production).toHaveCount(1);
  await expect(production.locator('.orders-card__price')).toHaveText(/R\$\s*112,00/);
  await expect(production).toContainText('Prato em preparo');
  await expect(production).not.toContainText('Prato da segunda rodada');

  await showStage(page, 'Concluir');
  const ready = page.locator('.orders-card--closing');
  await expect(ready).toHaveCount(1);
  await expect(ready.locator('.orders-card__price')).toHaveText(/R\$\s*48,00/);
  await expect(ready).toContainText('PRONTO / RECEBER');
  await expect(ready).not.toContainText('CONTA PEDIDA');
  await expect(ready).toContainText('Outro item continua em preparo.');
  await ready.getByRole('button', { name: 'Receber itens prontos', exact: true }).click();
  const paymentForm = page.locator('form').filter({ hasText: 'Receber Pagamento' });
  await expect(paymentForm.locator('input[inputmode="numeric"][readonly]')).toHaveValue('48,00');
  await expect(page.locator('.orders-detail-modal')).toHaveCount(0);
});

test('todos prontos não significam conta pedida', async ({ page }) => {
  await openOperationalScenario(page, { statuses: ['pronto', 'pronto'] });
  await expect(page.locator('.orders-board')).toBeVisible();
  await expect(page.locator('.orders-card--salon')).toHaveCount(0);
  await showStage(page, 'Concluir');
  const ready = page.locator('.orders-card--closing');
  await expect(ready).toHaveCount(1);
  await expect(ready.locator('.orders-card__price')).toHaveText(/R\$\s*160,00/);
  await expect(ready).toContainText('PRONTO / RECEBER');
  await expect(ready).not.toContainText('CONTA PEDIDA');
});

test('solicitação explícita de conta preserva a fatia financeira completa', async ({ page }) => {
  await openOperationalScenario(page, { checkStatus: 'aguardando_pagamento' });
  await expect(page.locator('.orders-board')).toBeVisible();
  await expect(page.locator('.orders-card--salon')).toHaveCount(0);
  await showStage(page, 'Concluir');
  const closing = page.locator('.orders-card--closing');
  await expect(closing).toHaveCount(1);
  await expect(closing.locator('.orders-card__price')).toHaveText(/R\$\s*160,00/);
  await expect(closing).toContainText('CONTA PEDIDA');
  await expect(closing).toContainText('Prato em preparo');
  await expect(closing).toContainText('Prato da segunda rodada');
});

test('lançamentos da mesma Comanda mantêm ações isoladas por item técnico', async ({ page }) => {
  const state = await openOperationalScenario(page, { statuses: ['preparando', 'preparando'] });
  const production = page.locator('.orders-card--salon');
  await expect(production).toHaveCount(2);
  await expect(production.nth(0).locator('.orders-card__price')).toHaveText(/R\$\s*112,00/);
  await expect(production.nth(1).locator('.orders-card__price')).toHaveText(/R\$\s*48,00/);
  await production.filter({ hasText: 'Prato em preparo' }).getByRole('button', { name: 'Marcar item como pronto' }).click();
  await expect.poll(() => state.writes).toEqual([
    { path: '/comandas/itens/item-phase7-1/status', status: 'pronto' },
  ]);
  await expect(page.locator('.orders-detail-modal')).toHaveCount(0);
});

test('salão preserva mesa livre e atendimento com consumo em aberto', async ({ page }) => {
  await openOperationalScenario(page, { statuses: ['preparando', 'preparando'], subtab: 'mesas' });
  const occupied = page.locator('article[data-table-status="occupied"]');
  const free = page.locator('article[data-table-status="free"]');
  await expect(occupied).toHaveCount(1);
  await expect(free).toHaveCount(1);
  await expect(occupied).toContainText('Em preparo');
  await expect(occupied).toHaveAttribute('data-operational-state', 'occupied');
  await expect(occupied).not.toContainText('Aguardando pagamento');
  await expect(occupied).toContainText(/R\$\s*160,00/);
  await expect(occupied.getByRole('button', { name: 'Ver comanda' })).toBeVisible();
  await expect(free.getByRole('button', { name: 'Abrir pedido' })).toBeVisible();
});

test('detalhes por teclado preservam a rota de impressão da fatia sem usar o número humano', async ({ page }) => {
  const state = await openOperationalScenario(page, { statuses: ['preparando', 'preparando'] });
  const firstLaunch = page.locator('.orders-card--salon').filter({ hasText: 'Prato em preparo' });
  await firstLaunch.focus();
  await firstLaunch.press('Enter');
  const details = page.locator('.orders-detail-modal');
  await expect(details).toContainText('Prato em preparo');
  await expect(details).not.toContainText('Prato da segunda rodada');
  await details.getByRole('button', { name: 'Reimprimir produção', exact: true }).click();
  await expect.poll(() => state.actions.filter(action => action.path.endsWith('/imprimir-recibo'))).toEqual([
    { path: '/comandas/check-phase7-24/imprimir-recibo', query: '', method: 'POST', body: null },
  ]);
  await expect(details).toHaveCount(0);
});

test('falha de impressão mantém os detalhes abertos e não informa sucesso', async ({ page }) => {
  const state = await openOperationalScenario(page, { printFails: true });
  const launch = page.locator('.orders-card--salon');
  await launch.focus();
  await launch.press('Space');
  const details = page.locator('.orders-detail-modal');
  await details.getByRole('button', { name: 'Reimprimir produção', exact: true }).click();
  await expect(page.getByText('Erro ao solicitar reimpressão.', { exact: true })).toBeVisible();
  await expect(details).toBeVisible();
  expect(state.actions.filter(action => action.path.endsWith('/imprimir-recibo'))).toHaveLength(1);
});

test('cancelar pelo detalhe do pedido envia somente os IDs dos itens daquela fatia', async ({ page }) => {
  const state = await openOperationalScenario(page, { statuses: ['preparando', 'preparando'] });
  await page.locator('.orders-card--salon').filter({ hasText: 'Prato em preparo' }).click();
  const details = page.locator('.orders-detail-modal');
  await expect(details.getByRole('combobox', { name: 'Mesa de destino' })).toHaveCount(0);
  await details.getByRole('button', { name: 'Cancelar somente este pedido', exact: true }).click();
  const confirmation = page.getByRole('dialog', { name: 'Cancelar somente este pedido?' });
  await expect(confirmation.getByRole('button', { name: 'Cancelar pedido', exact: true })).toBeDisabled();
  await confirmation.getByPlaceholder('Ex.: pedido lançado por engano').fill('Pedido lançado por engano');
  await confirmation.getByRole('button', { name: 'Cancelar pedido', exact: true }).click();
  await expect.poll(() => state.actions.filter(action => action.path.includes('/cancelar-'))).toEqual([
    {
      path: '/mesas/7/cancelar-itens', query: '', method: 'POST',
      body: { motivo: 'Pedido lançado por engano', item_ids: ['item-phase7-1'] },
    },
  ]);
  await expect(page.locator('.orders-card--salon')).toHaveCount(1);
  await expect(page.locator('.orders-card--salon')).toContainText('Prato da segunda rodada');
});

test('cancelar a mesa inteira permanece uma ação de Salão com motivo e escopo próprios', async ({ page }) => {
  const state = await openOperationalScenario(page, { subtab: 'mesas' });
  await page.locator('article[data-table-status="occupied"]').getByRole('button', { name: 'Ver comanda' }).click();
  const details = page.locator('.orders-detail-modal');
  await expect(details).toContainText('Prato em preparo');
  await expect(details).toContainText('Prato da segunda rodada');
  await details.getByRole('button', { name: 'Cancelar toda a mesa e liberar', exact: true }).click();
  const confirmation = page.getByRole('dialog', { name: 'Liberar Mesa 7 sem receber?' });
  await expect(confirmation.getByRole('button', { name: 'Cancelar e liberar', exact: true })).toBeDisabled();
  await confirmation.getByPlaceholder('Ex.: pedido lançado por engano').fill('Atendimento duplicado');
  await confirmation.getByRole('button', { name: 'Cancelar e liberar', exact: true }).click();
  await expect.poll(() => state.actions.filter(action => action.path.includes('/cancelar-'))).toEqual([
    { path: '/mesas/7/cancelar-consumo', query: '', method: 'POST', body: { motivo: 'Atendimento duplicado' } },
  ]);
});

test('transferência do Salão usa Comanda técnica e o destino selecionado', async ({ page }) => {
  const state = await openOperationalScenario(page, { subtab: 'mesas' });
  await page.locator('article[data-table-status="occupied"]').getByRole('button', { name: 'Ver comanda' }).click();
  const details = page.locator('.orders-detail-modal');
  await expect(details.getByRole('button', { name: 'Transferir', exact: true })).toBeDisabled();
  await details.getByRole('combobox', { name: 'Mesa de destino' }).selectOption('8');
  expect(state.actions.filter(action => action.path.includes('/transferir/'))).toHaveLength(0);
  await details.getByRole('button', { name: 'Transferir', exact: true }).click();
  await expect.poll(() => state.actions.filter(action => action.path.includes('/transferir/'))).toEqual([
    { path: '/comandas/check-phase7-24/transferir/8', query: '', method: 'POST', body: null },
  ]);
  await expect(details).toHaveCount(0);
});

test('busca e etapa móvel do Kanban sobrevivem à troca entre Pedidos e Salão', async ({ page }) => {
  await openOperationalScenario(page);
  const search = page.getByPlaceholder('Buscar mesa, cliente, telefone ou item');
  await search.fill('segunda rodada');
  const closingTab = page.getByRole('tab', { name: /Concluir/ });
  const compact = await closingTab.isVisible();
  if (compact) await closingTab.click();
  await expect(page.locator('.orders-card--closing')).toHaveCount(1);
  await expect(page.locator('.orders-card--salon')).toHaveCount(0);
  await page.getByRole('button', { name: 'Salão', exact: true }).click();
  await expect(page.locator('article[data-table-status="occupied"]')).toHaveCount(1);
  await page.getByRole('button', { name: 'Pedidos', exact: true }).click();
  await expect(search).toHaveValue('segunda rodada');
  await expect(page.locator('.orders-card--closing')).toHaveCount(1);
  await expect(page.locator('.orders-card--salon')).toHaveCount(0);
  if (compact) await expect(page.locator('.orders-column--closing')).toHaveClass(/is-mobile-active/);
});

test('identidade persistida aparece no lançamento, mas não identifica a Mesa agregada', async ({ page }) => {
  await openOperationalScenario(page, { canonicalIdentity: true, statuses: ['preparando', 'preparando'] });
  const firstLaunch = page.locator('.orders-card--salon').filter({ hasText: 'Prato em preparo' });
  await expect(firstLaunch).toContainText('Pedido 24-A');
  await firstLaunch.click();
  await expect(page.locator('.orders-detail-modal')).toContainText('24-A');
});

test('Mesa compartilhada mantém tempo, estado e ações do Caixa', async ({ page }, testInfo) => {
  await openOperationalScenario(page, { canonicalIdentity: true, subtab: 'mesas' });
  const card = page.locator('article[data-table-status="occupied"]');
  await expect(card).toHaveAttribute('data-operational-state', 'ready');
  await expect(card).toContainText('12m');
  await expect(card).toContainText('2 itens');
  await expect(card).not.toContainText('24-A');
  await expect(card.getByRole('button', { name: 'Ver comanda' })).toBeVisible();
  if (process.env.KOMA_CAPTURE_UI) await page.screenshot({ path: testInfo.outputPath('shared-table.png'), fullPage: true });
});
