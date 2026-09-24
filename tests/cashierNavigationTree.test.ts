import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  CASHIER_SIDEBAR_GROUPS,
  getCashierSidebarGroupsForPlan,
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
    'Pedidos', 'Novo pedido', 'Salão', 'Cozinha', 'Retiradas', 'Entregas',
  ]);
  assert.deepEqual(caixa?.children?.map((child) => child.label), [
    'Turno atual', 'Movimentações', 'Fechamento',
  ]);

  assert.deepEqual(getCashierNavigationTarget('vendas_cozinha'), { tab: 'operacao', subTab: 'kds' });
  assert.deepEqual(getCashierNavigationTarget('vendas_retiradas'), { tab: 'operacao', subTab: 'retiradas' });
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

test('gestão expõe relatórios e equipe como destinos canônicos', () => {
  const relatorios = parents().find((item) => item.id === 'relatorios');
  const equipe = parents().find((item) => item.id === 'permissoes_cargos');

  assert.deepEqual(relatorios?.children?.map((child) => child.label), [
    'Visão Geral',
    'Financeiro',
    'Produtos',
    'Equipe',
  ]);
  assert.deepEqual(equipe?.children?.map((child) => child.label), [
    'Pessoas',
    'Funções e acessos',
  ]);
  assert.deepEqual(getCashierNavigationTarget('relatorios'), {
    tab: 'relatorios', subTab: 'visao_geral',
  });
  assert.deepEqual(getCashierNavigationTarget('relatorios_visao_geral'), {
    tab: 'relatorios', subTab: 'visao_geral',
  });
  assert.deepEqual(getCashierNavigationTarget('relatorios_financeiro'), {
    tab: 'relatorios', subTab: 'financeiro',
  });
  assert.deepEqual(getCashierNavigationTarget('relatorios_produtos'), {
    tab: 'relatorios', subTab: 'produtos',
  });
  assert.deepEqual(getCashierNavigationTarget('relatorios_equipe'), {
    tab: 'relatorios', subTab: 'equipe',
  });
  assert.deepEqual(getCashierNavigationTarget('permissoes_cargos'), {
    tab: 'permissoes_cargos', subTab: 'pessoas',
  });
  assert.deepEqual(getCashierNavigationTarget('equipe_pessoas'), {
    tab: 'permissoes_cargos', subTab: 'pessoas',
  });
  assert.deepEqual(getCashierNavigationTarget('equipe_funcoes_acessos'), {
    tab: 'permissoes_cargos', subTab: 'cargos_permissoes',
  });
});

test('relatórios espelha os mesmos destinos canônicos na vertical e horizontal', () => {
  const caixa = readFileSync(new URL('../src/components/CaixaPanel.tsx', import.meta.url), 'utf8');
  assert.match(caixa, /reportsSubnavItems = getCashierNavigationItem\('relatorios'\)\?\.children \?\? \[\]/);
  assert.match(caixa, /\(activeTab === 'relatorios' \|\| activeTab === 'dashboard'\) && reportsSubnavItems\.map/);
  assert.match(caixa, /handleSidebarNavigation\(sub\.id\)/);
  assert.match(caixa, /isSidebarTabActive\(sub\.id\)/);
});

test('equipe espelha os mesmos destinos canônicos na vertical e horizontal', () => {
  const caixa = readFileSync(new URL('../src/components/CaixaPanel.tsx', import.meta.url), 'utf8');
  assert.match(caixa, /teamSubnavItems = getCashierNavigationItem\('permissoes_cargos'\)\?\.children \?\? \[\]/);
  assert.match(caixa, /activeTab === 'permissoes_cargos' && teamSubnavItems\.map/);
  assert.match(caixa, /handleSidebarNavigation\(sub\.id\)/);
  assert.match(caixa, /isSidebarTabActive\(sub\.id\)/);
});

test('configurações expõe os mesmos destinos canônicos para navegação vertical e horizontal', () => {
  const settings = parents().find((item) => item.id === 'impressao_salao');

  assert.deepEqual(settings?.children?.map((child) => child.label), [
    'Aparência',
    'Impressão',
    'Mesas',
    'App do Garçom',
    'Taxa de Serviço',
    'Implantação inicial',
    'Integrações',
  ]);
  assert.deepEqual(getCashierNavigationTarget('config_aparencia'), { tab: 'impressao_salao', subTab: 'aparencia' });
  assert.deepEqual(getCashierNavigationTarget('config_impressao'), { tab: 'impressao_salao', subTab: 'impressao' });
  assert.deepEqual(getCashierNavigationTarget('config_mesas'), { tab: 'impressao_salao', subTab: 'mesas' });
  assert.deepEqual(getCashierNavigationTarget('config_garcom'), { tab: 'impressao_salao', subTab: 'garcom' });
  assert.deepEqual(getCashierNavigationTarget('config_taxa'), { tab: 'impressao_salao', subTab: 'taxa' });
  assert.deepEqual(getCashierNavigationTarget('config_implantacao'), { tab: 'impressao_salao', subTab: 'implantacao' });
  assert.deepEqual(getCashierNavigationTarget('config_integracoes'), { tab: 'impressao_salao', subTab: 'integracoes' });

  const caixa = readFileSync(new URL('../src/components/CaixaPanel.tsx', import.meta.url), 'utf8');
  assert.match(caixa, /settingsSubnavItems = getCashierNavigationItem\('impressao_salao'\)\?\.children \?\? \[\]/);
  assert.match(caixa, /activeTab === 'impressao_salao' && settingsSubnavItems\.filter/);
  assert.match(caixa, /handleSidebarNavigation\(sub\.id\)/);
  assert.match(caixa, /isSidebarTabActive\(sub\.id\)/);
});

test('conta e assinatura espelha os mesmos destinos canônicos na vertical e horizontal', () => {
  const assinatura = parents().find((item) => item.id === 'assinatura_pix');
  assert.deepEqual(assinatura?.children?.map((child) => child.label), [
    'Meu Plano',
    'Planos & Upgrade',
    'Contrato e documentos',
  ]);
  assert.deepEqual(getCashierNavigationTarget('assinatura_meu_plano'), {
    tab: 'assinatura_pix', subTab: 'meu_plano',
  });
  assert.deepEqual(getCashierNavigationTarget('assinatura_planos_upgrade'), {
    tab: 'assinatura_pix', subTab: 'planos_upgrade',
  });
  assert.deepEqual(getCashierNavigationTarget('assinatura_contrato_documentos'), {
    tab: 'assinatura_pix', subTab: 'contrato_documentos',
  });

  const caixa = readFileSync(new URL('../src/components/CaixaPanel.tsx', import.meta.url), 'utf8');
  assert.match(caixa, /subscriptionSubnavItems = getCashierNavigationItem\('assinatura_pix'\)\?\.children \?\? \[\]/);
  assert.match(caixa, /activeTab === 'assinatura_pix' && subscriptionSubnavItems\.map/);
  assert.match(caixa, /handleSidebarNavigation\(sub\.id\)/);
  assert.match(caixa, /isSidebarTabActive\(sub\.id\)/);
});

test('navigation tree owns default tab and subtab destinations', () => {
  assert.deepEqual(getCashierNavigationTarget('operacao'), { tab: 'operacao', subTab: 'pedidos' });
  assert.deepEqual(getCashierNavigationTarget('financeiro'), { tab: 'financeiro', subTab: 'turno_atual' });
  assert.deepEqual(getCashierNavigationTarget('estoque'), { tab: 'estoque', subTab: 'insumos' });
  assert.deepEqual(getCashierNavigationTarget('cardapio_digital'), {
    tab: 'cardapio_digital', subTab: 'cardapio_perfil',
  });
  assert.deepEqual(getCashierNavigationTarget('impressao_salao'), {
    tab: 'impressao_salao', subTab: 'aparencia',
  });
  assert.deepEqual(getCashierNavigationTarget('assinatura_pix'), { tab: 'assinatura_pix', subTab: 'meu_plano' });
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
  assert.deepEqual(normalizeCashierNavigationState('configuracoes', 'planos'), {
    tab: 'assinatura_pix', subTab: 'meu_plano',
  });
  assert.deepEqual(normalizeCashierNavigationState('assinatura_pix', 'planos'), {
    tab: 'assinatura_pix', subTab: 'meu_plano',
  });
  assert.deepEqual(normalizeCashierNavigationState('impressao_salao', 'impressoras'), {
    tab: 'impressao_salao', subTab: 'impressao',
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
    ['cardapio_marca', 'online_marca'],
    ['cardapio_pedidos', 'online_pedidos'],
    ['cardapio_bloqueios', 'online_bloqueios'],
    ['cardapio_entrega', 'online_entrega'],
    ['cardapio_pagamentos', 'online_pagamentos'],
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
    assert.match(source, /groups=\{getCashierSidebarGroupsForPlan\(planId, entitlements\)\}/);
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


test('online menu mirrors canonical destinations across responsive section navigation', () => {
  const online = parents().find((item) => item.id === 'cardapio_digital');
  assert.deepEqual(online?.children?.map((child) => child.id), [
    'online_perfil',
    'online_marca',
    'online_pedidos',
    'online_bloqueios',
    'online_entrega',
    'online_pagamentos',
    'online_divulgacao',
  ]);

  const caixa = readFileSync(
    new URL('../src/components/CaixaPanel.tsx', import.meta.url), 'utf8',
  );
  assert.match(caixa, /onlineMenuSubnavItems = getCashierNavigationItem\('cardapio_digital'\)\?\.children \?\? \[\]/);
  assert.match(caixa, /activeTab === 'cardapio_digital'/);
  assert.match(caixa, /onlineMenuSubnavItems\.map/);
  assert.match(caixa, /activeTab === 'cardapio_digital' && onlineMenuSubnavItems\.map/);
  assert.doesNotMatch(caixa, /activeTab === 'cardapio_digital' && 'hidden'/);
});


test('restrições de plano vivem na árvore canônica, não em listas paralelas de ids', () => {
  const estoque = parents().find((item) => item.id === 'estoque');
  const relatorios = parents().find((item) => item.id === 'relatorios');
  const equipe = parents().find((item) => item.id === 'permissoes_cargos');
  const settings = parents().find((item) => item.id === 'impressao_salao');

  assert.deepEqual(estoque?.plans, ['pro', 'premium']);
  assert.deepEqual(relatorios?.plans, ['pro', 'premium']);
  assert.deepEqual(equipe?.plans, ['pro', 'premium']);
  assert.deepEqual(
    settings?.children?.find((child) => child.id === 'config_impressao')?.plans,
    ['pro', 'premium'],
  );
  assert.equal(
    settings?.children?.find((child) => child.id === 'config_garcom')?.requiredFeature,
    'waiter_app',
  );
  assert.equal(
    settings?.children?.find((child) => child.id === 'config_garcom')?.plans,
    undefined,
  );

  const source = readFileSync(
    new URL('../src/components/caixa/navigation/cashierNavigation.ts', import.meta.url), 'utf8',
  );
  assert.doesNotMatch(source, /hiddenPocketItems|hiddenPocketChildren/);
});

test('Pocket mostra apenas os grupos operacionais essenciais nesta primeira redução', () => {
  const pocketGroups = getCashierSidebarGroupsForPlan('pocket');
  const pocketItems = pocketGroups.flatMap((group) => group.items.map((item) => item.id));

  assert.deepEqual(pocketItems, [
    'operacao',
    'financeiro',
    'cardapio',
    'clientes',
    'cardapio_digital',
    'impressao_salao',
    'assinatura_pix',
  ]);
  assert.equal(pocketItems.includes('estoque'), false);
  assert.equal(pocketItems.includes('relatorios'), false);
  assert.equal(pocketItems.includes('permissoes_cargos'), false);

  const pocketSettings = pocketGroups
    .flatMap((group) => group.items)
    .find((item) => item.id === 'impressao_salao');
  assert.deepEqual(pocketSettings?.children?.map((child) => child.id), [
    'config_aparencia',
    'config_mesas',
    'config_garcom',
    'config_taxa',
    'config_implantacao',
    'config_integracoes',
  ]);
  assert.equal(pocketSettings?.children?.some((child) => child.id === 'config_impressao'), false);
  assert.equal(pocketSettings?.children?.some((child) => child.id === 'config_garcom'), true);

  const pocketCardapio = pocketGroups
    .flatMap((group) => group.items)
    .find((item) => item.id === 'cardapio');
  assert.equal(
    pocketCardapio?.children?.find((child) => child.id === 'cardapio_preparo')?.label,
    'Preparo',
  );

  const pocketOperation = pocketGroups
    .flatMap((group) => group.items)
    .find((item) => item.id === 'operacao');
  const pocketKitchen = pocketOperation?.children?.find((child) => child.id === 'vendas_cozinha');
  assert.equal(pocketKitchen?.label, 'Preparo');
  assert.deepEqual(pocketKitchen?.target, { tab: 'operacao', subTab: 'preparo' });

  assert.deepEqual(getCashierSidebarGroupsForPlan('pro'), CASHIER_SIDEBAR_GROUPS);
  assert.deepEqual(getCashierSidebarGroupsForPlan('premium'), CASHIER_SIDEBAR_GROUPS);
});


test('explicit entitlement overrides can grant or revoke plan navigation capabilities', () => {
  const pocketWithAddons = getCashierSidebarGroupsForPlan('pocket', {
    printing: true,
    kds: true,
  });
  const pocketSettings = pocketWithAddons.flatMap((group) => group.items).find((item) => item.id === 'impressao_salao');
  assert.equal(pocketSettings?.children?.some((child) => child.id === 'config_impressao'), true);
  assert.equal(pocketSettings?.children?.some((child) => child.id === 'config_garcom'), true);
  assert.equal(
    pocketWithAddons.flatMap((group) => group.items).find((item) => item.id === 'operacao')
      ?.children?.find((child) => child.id === 'vendas_cozinha')?.target.subTab,
    'kds',
  );

  const premiumRevoked = getCashierSidebarGroupsForPlan('premium', {
    printing: false,
    waiter_app: false,
  });
  const premiumSettings = premiumRevoked.flatMap((group) => group.items).find((item) => item.id === 'impressao_salao');
  assert.equal(premiumSettings?.children?.some((child) => child.id === 'config_impressao'), false);
  assert.equal(premiumSettings?.children?.some((child) => child.id === 'config_garcom'), false);
});
