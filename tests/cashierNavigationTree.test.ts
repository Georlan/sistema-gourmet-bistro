import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  CASHIER_SIDEBAR_GROUPS,
  getCashierNavigationAction,
  getCashierNavigationParentId,
  getCashierNavigationTarget,
  isCashierNavigationActive,
  normalizeCashierNavigationState,
} from '../src/components/caixa/navigation/cashierNavigation';

const parents = () => CASHIER_SIDEBAR_GROUPS.flatMap((group) => group.items);
const children = () => parents().flatMap((parent) => parent.children ?? []);

test('navigation tree v2 has the intended product information architecture', () => {
  assert.deepEqual(
    CASHIER_SIDEBAR_GROUPS.map((group) => group.category),
    ['Operação', 'Cadastros', 'Vendas online', 'Gestão', 'Sistema'],
  );

  const items = parents();
  const allIds = [...items.map((item) => item.id), ...children().map((item) => item.id)];
  assert.equal(new Set(allIds).size, allIds.length, 'navigation ids must be unique across the whole tree');
  assert.deepEqual(
    items.map((item) => [item.id, item.label]),
    [
      ['operacao', 'Vendas'],
      ['financeiro', 'Caixa'],
      ['cardapio', 'Cardápio'],
      ['estoque', 'Estoque & compras'],
      ['clientes', 'Clientes'],
      ['cardapio_digital', 'Cardápio online'],
      ['relatorios', 'Relatórios'],
      ['permissoes_cargos', 'Equipe'],
      ['impressao_salao', 'Configurações'],
      ['assinatura_pix', 'Conta & assinatura'],
    ],
  );
});

test('vendas and caixa expose existing operational views as children', () => {
  const vendas = parents().find((item) => item.id === 'operacao');
  const caixa = parents().find((item) => item.id === 'financeiro');

  assert.deepEqual(vendas?.children?.map((child) => child.label), [
    'Pedidos', 'Novo pedido', 'Salão', 'Cozinha', 'Entregas',
  ]);
  assert.deepEqual(caixa?.children?.map((child) => child.label), [
    'Turno atual', 'Movimentações', 'Fechamento',
  ]);

  assert.deepEqual(getCashierNavigationTarget('vendas_cozinha'), { tab: 'operacao', subTab: 'kds' });
  assert.deepEqual(getCashierNavigationTarget('vendas_entregas'), { tab: 'operacao', subTab: 'entregadores' });
  assert.deepEqual(getCashierNavigationTarget('caixa_fechamento'), { tab: 'financeiro', subTab: 'fechamento' });
  assert.equal(getCashierNavigationParentId('vendas_salao'), 'operacao');
  assert.equal(getCashierNavigationParentId('caixa_movimentacoes'), 'financeiro');
});

test('cadastros keep sidebar compact while preserving existing workspace owners', () => {
  const cardapio = parents().find((item) => item.id === 'cardapio');
  const estoque = parents().find((item) => item.id === 'estoque');
  const clientes = parents().find((item) => item.id === 'clientes');

  assert.deepEqual(cardapio?.children?.map((child) => child.label), [
    'Produtos', 'Complementos', 'Preparo e impressão',
  ]);
  assert.deepEqual(estoque?.children?.map((child) => child.label), [
    'Estoque', 'Compras', 'Inventário', 'Fornecedores',
  ]);
  assert.equal(clientes?.children, undefined);

  assert.deepEqual(getCashierNavigationTarget('cardapio_preparo'), { tab: 'cardapio', subTab: 'categorias' });
  assert.deepEqual(getCashierNavigationTarget('estoque_fornecedores'), { tab: 'estoque', subTab: 'fornecedores' });
  assert.deepEqual(getCashierNavigationTarget('clientes'), { tab: 'clientes', subTab: 'clientes' });
  assert.equal(getCashierNavigationTarget('clientes_cupons'), undefined);
});

test('gestao keeps reports and team as single sidebar destinations', () => {
  const relatorios = parents().find((item) => item.id === 'relatorios');
  const equipe = parents().find((item) => item.id === 'permissoes_cargos');

  assert.equal(relatorios?.children, undefined);
  assert.equal(equipe?.children, undefined);
  assert.deepEqual(getCashierNavigationTarget('relatorios'), {
    tab: 'relatorios', subTab: 'visao_geral',
  });
  assert.deepEqual(getCashierNavigationTarget('permissoes_cargos'), {
    tab: 'permissoes_cargos', subTab: 'pessoas',
  });
  assert.equal(getCashierNavigationTarget('relatorios_financeiro'), undefined);
  assert.equal(getCashierNavigationTarget('equipe_funcoes_acessos'), undefined);
});

test('navigation tree owns default tab and subtab destinations', () => {
  assert.deepEqual(getCashierNavigationTarget('operacao'), { tab: 'operacao', subTab: 'pedidos' });
  assert.deepEqual(getCashierNavigationTarget('financeiro'), { tab: 'financeiro', subTab: 'turno_atual' });
  assert.deepEqual(getCashierNavigationTarget('estoque'), { tab: 'estoque', subTab: 'insumos' });
  assert.deepEqual(getCashierNavigationTarget('cardapio_digital'), {
    tab: 'cardapio_digital', subTab: 'cardapio_perfil',
  });
  assert.deepEqual(getCashierNavigationTarget('assinatura_pix'), { tab: 'assinatura_pix', subTab: 'planos' });
  assert.equal(getCashierNavigationTarget('nao-existe'), undefined);
});

test('novo pedido keeps PDV openCounter as the owner of counter initialization', () => {
  assert.equal(getCashierNavigationAction('vendas_novo_pedido'), 'open-counter');
  assert.deepEqual(getCashierNavigationTarget('vendas_novo_pedido'), { tab: 'operacao', subTab: 'balcao' });

  const navigationController = readFileSync(
    new URL('../src/components/caixa/navigation/useCashierNavigation.ts', import.meta.url), 'utf8',
  );
  const pdvController = readFileSync(
    new URL('../src/components/caixa/pdv/useCashierPdv.ts', import.meta.url), 'utf8',
  );
  assert.match(navigationController, /koma-navigation-open-counter/);
  assert.match(pdvController, /addEventListener\('koma-navigation-open-counter'/);
  assert.match(pdvController, /handleNavigationOpenCounter = \(\) => openCounter\(\)/);
});

test('persisted aliases normalize with the active parent context', () => {
  assert.deepEqual(normalizeCashierNavigationState('financeiro', 'movimentacoes'), {
    tab: 'financeiro', subTab: 'movimentacoes',
  });
  assert.deepEqual(normalizeCashierNavigationState('estoque', 'movimentacoes'), {
    tab: 'estoque', subTab: 'historico',
  });
  assert.deepEqual(normalizeCashierNavigationState('estoque', 'contagem'), {
    tab: 'estoque', subTab: 'inventario',
  });
  assert.deepEqual(normalizeCashierNavigationState('configuracoes', 'equipe'), {
    tab: 'permissoes_cargos', subTab: 'pessoas',
  });
  assert.deepEqual(normalizeCashierNavigationState('dashboard', 'dre'), {
    tab: 'relatorios', subTab: 'financeiro',
  });
  assert.deepEqual(normalizeCashierNavigationState('relatorios', 'fluxo_caixa'), {
    tab: 'relatorios', subTab: 'financeiro',
  });
});

test('a stale or mismatched child falls back to the selected parent default', () => {
  assert.deepEqual(normalizeCashierNavigationState('financeiro', 'produtos'), {
    tab: 'financeiro', subTab: 'turno_atual',
  });
  assert.deepEqual(normalizeCashierNavigationState('cardapio_digital', 'fechamento'), {
    tab: 'cardapio_digital', subTab: 'cardapio_perfil',
  });
  assert.deepEqual(normalizeCashierNavigationState('unknown', 'unknown'), {
    tab: 'operacao', subTab: 'pedidos',
  });
});

test('every nested parent always has exactly one active child', () => {
  for (const parent of parents().filter((item) => item.children?.length)) {
    const states = [parent.target, ...(parent.children ?? []).map((child) => child.target)];
    for (const state of states) {
      const activeChildren = parent.children?.filter((child) =>
        isCashierNavigationActive(child.id, state.tab, state.subTab)) ?? [];
      assert.equal(activeChildren.length, 1, `${parent.id}/${state.subTab} must have one active child`);
      assert.equal(isCashierNavigationActive(parent.id, state.tab, state.subTab), true);
    }
  }
});

test('child aliases select the canonical visible shortcut only inside their parent', () => {
  assert.equal(isCashierNavigationActive('caixa_fechamento', 'financeiro', 'conferencia_cega'), true);
  assert.equal(isCashierNavigationActive('estoque_historico', 'estoque', 'movimentacoes'), true);
  assert.equal(isCashierNavigationActive('caixa_movimentacoes', 'estoque', 'movimentacoes'), false);
  assert.equal(isCashierNavigationActive('estoque_inventario', 'estoque', 'contagem'), true);
});

test('online-menu detail sections stay open under exactly one sidebar child', () => {
  const cases = [
    ['cardapio_marca', 'online_loja'],
    ['cardapio_entrega', 'online_operacao'],
    ['cardapio_pagamentos', 'online_operacao'],
    ['cardapio_qr_links', 'online_divulgacao'],
  ] as const;
  const online = parents().find((item) => item.id === 'cardapio_digital');

  for (const [subTab, expectedChild] of cases) {
    assert.deepEqual(normalizeCashierNavigationState('cardapio_digital', subTab), {
      tab: 'cardapio_digital', subTab,
    });
    const activeChildren = online?.children?.filter((child) =>
      isCashierNavigationActive(child.id, 'cardapio_digital', subTab)) ?? [];
    assert.deepEqual(activeChildren.map((child) => child.id), [expectedChild]);
  }
});

test('online menu and subscription are primary navigation, not duplicated footer shortcuts', () => {
  const footer = readFileSync(
    new URL('../src/components/caixa/navigation/CashierSidebarFooter.tsx', import.meta.url), 'utf8',
  );
  assert.doesNotMatch(footer, /CASHIER_SIDEBAR_SECONDARY_ITEMS/);
  assert.doesNotMatch(footer, /Acesso rápido/);
  assert.doesNotMatch(footer, /hasOnlineMenu|handleSidebarNavigation/);
});

test('desktop and mobile delegate nested rendering to the same component', () => {
  const desktop = readFileSync(
    new URL('../src/components/caixa/navigation/CashierDesktopSidebar.tsx', import.meta.url), 'utf8',
  );
  const mobile = readFileSync(
    new URL('../src/components/caixa/navigation/CashierMobileSidebar.tsx', import.meta.url), 'utf8',
  );
  for (const source of [desktop, mobile]) {
    assert.match(source, /CashierSidebarNavigation/);
    assert.match(source, /groups=\{CASHIER_SIDEBAR_GROUPS\}/);
    assert.doesNotMatch(source, /group\.items\.map/);
  }
});

test('operation horizontal tabs mirror Navigation Tree v2 children', () => {
  const caixa = readFileSync(
    new URL('../src/components/CaixaPanel.tsx', import.meta.url), 'utf8',
  );
  assert.match(caixa, /operationSubnavItems = getCashierNavigationItem\('operacao'\)\?\.children \?\? \[\]/);
  assert.match(caixa, /operationSubnavItems\.map/);
});

test('CaixaPanel delegates operation subnav clicks and active state to the shared navigation controller', () => {
  const caixa = readFileSync(
    new URL('../src/components/CaixaPanel.tsx', import.meta.url), 'utf8',
  );
  assert.match(caixa, /handleSidebarNavigation\(sub\.id\)/);
  assert.match(caixa, /isSidebarTabActive\(sub\.id\)/);
});
