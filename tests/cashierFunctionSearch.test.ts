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
  assert.equal(result?.id, 'settings_garcom');
  assert.equal(result?.label, 'App do Garçom');
  assert.equal(result?.navigationId, 'config_operacao');
  assert.equal(result?.settingsTab, 'garcom');
});

test('aliases find internal settings without requiring exact menu labels', () => {
  assert.equal(searchCashierFunctions(entries, 'atendente')[0]?.id, 'settings_garcom');
  assert.equal(searchCashierFunctions(entries, 'tema')[0]?.id, 'settings_aparencia');
  assert.equal(searchCashierFunctions(entries, 'impressora')[0]?.id, 'settings_impressao');
  assert.equal(searchCashierFunctions(entries, 'gorjeta')[0]?.id, 'settings_taxa');
});

test('operational aliases route common restaurant language to the canonical function', () => {
  assert.equal(searchCashierFunctions(entries, 'sangria')[0]?.id, 'caixa_movimentacoes');
  assert.equal(searchCashierFunctions(entries, 'pdv')[0]?.id, 'vendas_novo_pedido');
  assert.equal(searchCashierFunctions(entries, 'mercado pago')[0]?.id, 'config_integracoes');
  assert.equal(searchCashierFunctions(entries, 'qr code')[0]?.id, 'online_divulgacao');
});

test('exact function names outrank broader related labels', () => {
  assert.equal(searchCashierFunctions(entries, 'mesas')[0]?.id, 'settings_mesas');
  assert.equal(searchCashierFunctions(entries, 'impressão')[0]?.id, 'settings_impressao');
});

test('online-only destinations are omitted when the capability is unavailable', () => {
  const withoutOnlineMenu = buildCashierFunctionSearchEntries(CASHIER_SIDEBAR_GROUPS, false);
  assert.equal(searchCashierFunctions(withoutOnlineMenu, 'qr code').length, 0);
  assert.equal(searchCashierFunctions(withoutOnlineMenu, 'loja online').length, 0);
});

test('sidebar search deep-links internal settings and settings listens to live requests', () => {
  const searchSource = readFileSync(
    new URL('../src/components/caixa/navigation/CashierSidebarSearch.tsx', import.meta.url),
    'utf8',
  );
  const settingsSource = readFileSync(
    new URL('../src/components/caixa/settings/CashierSettings.tsx', import.meta.url),
    'utf8',
  );

  assert.match(searchSource, /requestCashierSettingsTab\(entry\.settingsTab\)/);
  assert.match(searchSource, /ArrowDown/);
  assert.match(searchSource, /ArrowUp/);
  assert.match(settingsSource, /CASHIER_SETTINGS_TAB_REQUEST_EVENT/);
  assert.match(settingsSource, /getRequestedCashierSettingsTab/);
});
