import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { CASHIER_SIDEBAR_GROUPS } from '../src/components/caixa/navigation/cashierNavigation';
import {
  buildCashierFunctionSearchEntries,
  normalizeCashierFunctionSearch,
  searchCashierFunctions,
} from '../src/components/caixa/navigation/cashierFunctionSearch';

const entries = buildCashierFunctionSearchEntries(CASHIER_SIDEBAR_GROUPS, true);

test('function search ignores accents and ranks App do Garçom as the primary garçom result', () => {
  assert.equal(normalizeCashierFunctionSearch('Garçom'), 'garcom');

  const [result] = searchCashierFunctions(entries, 'garçom');
  assert.equal(result?.id, 'config_garcom');
  assert.equal(result?.label, 'App do Garçom');
  assert.equal(result?.navigationId, 'config_garcom');
});

test('aliases find internal settings without requiring exact menu labels', () => {
  assert.equal(searchCashierFunctions(entries, 'atendente')[0]?.id, 'config_garcom');
  assert.equal(searchCashierFunctions(entries, 'tema')[0]?.id, 'config_aparencia');
  assert.equal(searchCashierFunctions(entries, 'impressora')[0]?.id, 'config_impressao');
  assert.equal(searchCashierFunctions(entries, 'gorjeta')[0]?.id, 'config_taxa');
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
