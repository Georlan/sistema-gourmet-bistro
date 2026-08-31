import { expect, type Page } from '@playwright/test';

// Characterization written against the pre-Fase-7 consumers. These are UI
// slices of a check, not a new pricing rule or a financial state machine.
export const API_ORIGIN = 'http://127.0.0.1:8000';

type Scenario = {
  statuses?: string[];
  checkStatus?: 'aguardando_pagamento' | null;
  subtab?: 'pedidos' | 'mesas';
  sameLaunch?: boolean;
  printFails?: boolean;
  canonicalIdentity?: boolean;
  secondCheck?: boolean;
};

export async function openOperationalScenario(page: Page, scenario: Scenario = {}) {
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
  const checks = [check, ...(scenario.secondCheck ? [{
    ...check, id: 'check-phase7-25', numero_pedido: 25,
    garcom_id: 'waiter-bruno', criada_por: { nome: 'Bruno' },
    lancamentos: [{ id: 'launch-phase7-extra', display_number: '25-Z', comanda_id: 'check-phase7-25', origem: 'garcom', timestamp: createdAt }],
    itens: [{ ...items[0], id: 'item-phase7-extra', lancamento_id: 'launch-phase7-extra', preco_unit: 12, status: 'entregue' }],
  }] : [])];
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
    if (path === '/comandas/detalhes/todos') body = checks;
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

export async function showStage(page: Page, stage: 'Salão' | 'Concluir') {
  await expect(page.locator('.orders-board')).toBeVisible();
  const stageTab = page.getByRole('tab', { name: new RegExp(stage) });
  if (await stageTab.isVisible()) await stageTab.click();
}
