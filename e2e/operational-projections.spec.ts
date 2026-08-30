import { expect, Page, test } from '@playwright/test';

// Characterization written against the pre-Fase-7 consumers. These are UI
// slices of a check, not a new pricing rule or a financial state machine.
const API_ORIGIN = 'http://127.0.0.1:8000';

type Scenario = {
  statuses?: string[];
  checkStatus?: 'aguardando_pagamento' | null;
  subtab?: 'pedidos' | 'mesas';
  sameLaunch?: boolean;
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
      comanda_id: 'check-phase7-24',
      origem: 'garcom',
      timestamp: createdAt,
    })),
    itens: items,
  };
  const writes: { path: string; status: string | null }[] = [];

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
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.goto('/?view=caixa');
  return { writes };
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
});

test('salão preserva mesa livre e atendimento com consumo em aberto', async ({ page }) => {
  await openOperationalScenario(page, { statuses: ['preparando', 'preparando'], subtab: 'mesas' });
  const occupied = page.locator('article[data-table-status="occupied"]');
  const free = page.locator('article[data-table-status="free"]');
  await expect(occupied).toHaveCount(1);
  await expect(free).toHaveCount(1);
  await expect(occupied).toContainText('Em atendimento');
  await expect(occupied).toContainText(/R\$\s*160,00/);
  await expect(occupied.getByRole('button', { name: 'Ver comanda' })).toBeVisible();
  await expect(free.getByRole('button', { name: 'Abrir pedido' })).toBeVisible();
});
