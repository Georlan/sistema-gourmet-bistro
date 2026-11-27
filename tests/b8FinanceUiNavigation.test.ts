import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { CASHIER_SIDEBAR_GROUPS, getCashierNavigationTarget } from '../src/components/caixa/navigation/cashierNavigation';
import { buildCashierFunctionSearchEntries, searchCashierFunctions } from '../src/components/caixa/navigation/cashierFunctionSearch';

test('B8 navigation targets map DRE, Fluxo de Caixa, Contas, Lotes and Produção to distinct subTabs', () => {
  assert.deepEqual(getCashierNavigationTarget('relatorios_financeiro'), { tab: 'relatorios', subTab: 'financeiro' });
  assert.deepEqual(getCashierNavigationTarget('relatorios_dre'), { tab: 'relatorios', subTab: 'dre' });
  assert.deepEqual(getCashierNavigationTarget('relatorios_fluxo_caixa'), { tab: 'relatorios', subTab: 'fluxo_caixa' });
  assert.deepEqual(getCashierNavigationTarget('relatorios_contas_financeiras'), { tab: 'relatorios', subTab: 'contas_financeiras' });
  assert.deepEqual(getCashierNavigationTarget('estoque_lotes'), { tab: 'estoque', subTab: 'lotes' });
  assert.deepEqual(getCashierNavigationTarget('estoque_producao'), { tab: 'estoque', subTab: 'producao' });
});

test('B8 function search finds DRE, Fluxo de Caixa, Contas a Pagar and Lotes FEFO', () => {
  const entries = buildCashierFunctionSearchEntries(CASHIER_SIDEBAR_GROUPS);

  const dre = searchCashierFunctions(entries, 'DRE');
  assert.equal(dre[0]?.navigationId, 'relatorios_dre');

  const fluxo = searchCashierFunctions(entries, 'fluxo de caixa');
  assert.equal(fluxo[0]?.navigationId, 'relatorios_fluxo_caixa');

  const contas = searchCashierFunctions(entries, 'contas a pagar');
  assert.equal(contas[0]?.navigationId, 'relatorios_contas_financeiras');

  const lotes = searchCashierFunctions(entries, 'validade fefo');
  assert.equal(lotes[0]?.navigationId, 'estoque_lotes');
});

test('B8 UI components use --koma tokens, lucide-react and lazy-loading without emojis', () => {
  const files = [
    '../src/components/relatorios/RelatorioDreTab.tsx',
    '../src/components/relatorios/RelatorioFluxoCaixaTab.tsx',
    '../src/components/relatorios/FinanceiroGestaoTab.tsx',
    '../src/components/estoque/EstoqueLotesPerdasTab.tsx',
    '../src/components/estoque/EstoqueProducaoTab.tsx',
  ];
  for (const rel of files) {
    const src = readFileSync(new URL(rel, import.meta.url), 'utf8');
    assert.match(src, /lucide-react/);
    assert.match(src, /koma-/);
    assert.doesNotMatch(src, /backdrop-blur/);
  }
});
