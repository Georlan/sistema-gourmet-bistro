import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = (path: string) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');

test('fidelity owner reuses the deterministic calculator for points and cashback', () => {
  const panel = source('src/components/caixa/customers/CashierCustomers.tsx');
  assert.match(panel, /GrowthEconomicsCalculator/);
  assert.match(panel, /onApplyOption=\{handleApplyGrowthOptionToLoyalty\}/);
  assert.match(panel, /Usar no cashback/);
  assert.match(panel, /Usar nos pontos/);
});

test('loyalty suggestion only fills current config and never saves automatically', () => {
  const panel = source('src/components/caixa/customers/CashierCustomers.tsx');
  const handler = panel.slice(
    panel.indexOf('const handleApplyGrowthOptionToLoyalty'),
    panel.indexOf('const [editingCrmUser'),
  );

  assert.match(handler, /option\.cashback\.earn_percent/);
  assert.match(handler, /option\.loyalty_points\.points_per_real/);
  assert.match(handler, /option\.loyalty_points\.suggested_point_value_brl/);
  assert.match(handler, /Revise e edite se quiser antes de salvar/);
  assert.doesNotMatch(handler, /fetch\(|handleSaveFidelidadeConfig\(/);
});

test('manual fidelity controls remain editable after applying a suggestion', () => {
  const panel = source('src/components/caixa/customers/CashierCustomers.tsx');
  assert.match(panel, /value=\{fidelidadeConfig\.taxa_conversao\}/);
  assert.match(panel, /value=\{fidelidadeConfig\.valor_ponto_em_dinheiro\}/);
  assert.match(panel, /step="0\.0001"/);
  assert.match(panel, />\s*Salvar programa\s*</);
});
