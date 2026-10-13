import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { CASHIER_SIDEBAR_GROUPS, getCashierSidebarGroupsForPlan, getCashierSetupSidebarGroupsForPlan, getCashierNavigationTarget } from '../src/components/caixa/navigation/cashierNavigation';
import {
  buildCashierFunctionSearchEntries,
  normalizeCashierFunctionSearch,
  searchCashierFunctions,
} from '../src/components/caixa/navigation/cashierFunctionSearch';

const entries = buildCashierFunctionSearchEntries(CASHIER_SIDEBAR_GROUPS, true);

test('subjects inside screens lead to the specific owner rather than a generic tab', () => {
  for (const query of ['CMV', 'onde vejo o CMV', 'margem de contribuição', 'simulação de preço', 'custo da mercadoria vendida']) {
    const result = searchCashierFunctions(entries, query)[0];
    assert.equal(result?.navigationId, 'relatorios_cardapio', query);
    assert.deepEqual(getCashierNavigationTarget(result!.navigationId), { tab: 'relatorios', subTab: 'gestao_cardapio' });
    assert.match(result!.description!, /CMV estimado/);
  }
  for (const query of ['pontos', 'cashback', 'programa de pontos']) {
    assert.equal(searchCashierFunctions(entries, query)[0]?.id, 'clientes_fidelidade', query);
  }
  assert.equal(searchCashierFunctions(entries, 'cupom desconto')[0]?.id, 'clientes_cupons');
  assert.equal(searchCashierFunctions(entries, 'nota fiscal')[0]?.id, 'config_fiscal');
  assert.deepEqual(getCashierNavigationTarget('config_fiscal'), { tab: 'impressao_salao', subTab: 'fiscal' });
  assert.equal(searchCashierFunctions(entries, 'pagbank')[0]?.id, 'config_integracoes');
  assert.equal(searchCashierFunctions(entries, 'ficha técnica')[0]?.id, 'estoque_ingredientes');
});

test('content search does not expose features absent from effective entitlements or setup', () => {
  const restricted = buildCashierFunctionSearchEntries(getCashierSidebarGroupsForPlan('premium', {
    printing: false, kds: false, waiter_app: false, inventory: false, advanced_reports: false, loyalty: false, coupons: false,
  }), true);
  for (const query of ['cmv', 'cashback', 'pontos', 'cupom desconto', 'impressora', 'compras']) {
    assert.deepEqual(searchCashierFunctions(restricted, query), [], query);
  }
  const setup = buildCashierFunctionSearchEntries(getCashierSetupSidebarGroupsForPlan('premium', {
    printing: true, kds: true, waiter_app: true, inventory: true, advanced_reports: true, loyalty: true, coupons: true,
  }), true);
  assert.deepEqual(searchCashierFunctions(setup, 'cmv'), []);
  assert.deepEqual(searchCashierFunctions(setup, 'cashback'), []);
  assert.equal(searchCashierFunctions(setup, 'nota fiscal')[0]?.id, 'config_fiscal');
});

test('function search ignores accents and ranks App do Garçom as the primary garçom result', () => {
  assert.equal(normalizeCashierFunctionSearch('Garçom'), 'garcom');

  const [result] = searchCashierFunctions(entries, 'garçom');
  assert.equal(result?.id, 'config_atendimento');
  assert.equal(result?.label, 'Atendimento');
  assert.equal(result?.navigationId, 'config_atendimento');
});

test('aliases find internal settings without requiring exact menu labels', () => {
  assert.equal(searchCashierFunctions(entries, 'atendente')[0]?.id, 'config_atendimento');
  assert.equal(searchCashierFunctions(entries, 'tema')[0]?.id, 'config_aparencia');
  assert.equal(searchCashierFunctions(entries, 'impressora')[0]?.id, 'config_impressao');
  assert.equal(searchCashierFunctions(entries, 'gorjeta')[0]?.id, 'config_atendimento');
  assert.equal(searchCashierFunctions(entries, 'implantação')[0]?.id, 'config_implantacao');
});

test('operational aliases route common restaurant language to the canonical function', () => {
  assert.equal(searchCashierFunctions(entries, 'sangria')[0]?.id, 'caixa_movimentacoes');
  assert.equal(searchCashierFunctions(entries, 'pdv')[0]?.id, 'vendas_novo_pedido');
  assert.equal(searchCashierFunctions(entries, 'retiradas')[0]?.id, 'vendas_retiradas');
  assert.equal(searchCashierFunctions(entries, 'pickup')[0]?.id, 'vendas_retiradas');
  assert.equal(searchCashierFunctions(entries, 'mercado pago')[0]?.id, 'config_integracoes');
  assert.equal(searchCashierFunctions(entries, 'qr code')[0]?.id, 'online_divulgacao');
  assert.equal(searchCashierFunctions(entries, 'entrega')[0]?.id, 'online_entrega');
  assert.equal(searchCashierFunctions(entries, 'taxa de entrega')[0]?.id, 'online_entrega');
  assert.equal(searchCashierFunctions(entries, 'clientes bloqueados')[0]?.id, 'online_bloqueios');
});

test('team aliases open the canonical team section directly', () => {
  assert.equal(searchCashierFunctions(entries, 'funcionários')[0]?.id, 'equipe_pessoas');
  assert.equal(searchCashierFunctions(entries, 'convites')[0]?.id, 'equipe_pessoas');
  assert.equal(searchCashierFunctions(entries, 'funções')[0]?.id, 'equipe_funcoes_acessos');
  assert.equal(searchCashierFunctions(entries, 'permissões')[0]?.id, 'equipe_funcoes_acessos');
});

test('subscription aliases open the canonical account section directly', () => {
  assert.equal(searchCashierFunctions(entries, 'meu plano')[0]?.id, 'assinatura_meu_plano');
  assert.equal(searchCashierFunctions(entries, 'comparar planos')[0]?.id, 'assinatura_planos_upgrade');
  assert.equal(searchCashierFunctions(entries, 'contrato')[0]?.id, 'assinatura_contrato_documentos');
  assert.equal(searchCashierFunctions(entries, 'documentos')[0]?.id, 'assinatura_contrato_documentos');
});

test('report aliases open the canonical report section directly', () => {
  assert.equal(searchCashierFunctions(entries, 'dre')[0]?.id, 'relatorios_financeiro');
  assert.equal(searchCashierFunctions(entries, 'mais vendidos')[0]?.id, 'relatorios_produtos');
  assert.equal(searchCashierFunctions(entries, 'desempenho equipe')[0]?.id, 'relatorios_equipe');
  assert.equal(searchCashierFunctions(entries, 'visão geral')[0]?.id, 'relatorios_visao_geral');
});

test('exact function names outrank broader related labels', () => {
  assert.equal(searchCashierFunctions(entries, 'mesas')[0]?.id, 'config_mesas');
  assert.equal(searchCashierFunctions(entries, 'impressão')[0]?.id, 'config_impressao');
});

test('online-only destinations are omitted when the capability is unavailable', () => {
  const withoutOnlineMenu = buildCashierFunctionSearchEntries(CASHIER_SIDEBAR_GROUPS, false);
  assert.equal(searchCashierFunctions(withoutOnlineMenu, 'qr code').length, 0);
  assert.equal(searchCashierFunctions(withoutOnlineMenu, 'loja online').length, 0);
});

test('sidebar search usa a mesma navegação canônica das abas de configurações', () => {
  const searchSource = readFileSync(
    new URL('../src/components/caixa/navigation/CashierSidebarSearch.tsx', import.meta.url),
    'utf8',
  );
  const settingsSource = readFileSync(
    new URL('../src/components/caixa/settings/CashierSettings.tsx', import.meta.url),
    'utf8',
  );

  assert.doesNotMatch(searchSource, /requestCashierSettingsTab|settingsTab/);
  assert.match(searchSource, /handleSidebarNavigation\(entry\.navigationId, closeMobile\)/);
  assert.match(searchSource, /ArrowDown/);
  assert.match(searchSource, /ArrowUp/);
  assert.doesNotMatch(settingsSource, /CASHIER_SETTINGS_TAB_REQUEST_EVENT|getRequestedCashierSettingsTab|cashier-settings-tab/);
});
