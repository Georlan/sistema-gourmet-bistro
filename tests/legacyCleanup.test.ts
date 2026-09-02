import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = (path: string) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');

test('cashier service does not restore the obsolete duplicate employee reader', () => {
  const service = source('src/config/caixaService.ts');
  assert.doesNotMatch(service, /export const getFuncionarios/);
  assert.doesNotMatch(service, /\bgetFuncionarios,\s*/);
  assert.match(service, /export const cadastrarFuncionario/);
});

test('cashier salon projection is imported from its canonical owner without compatibility re-export', () => {
  const orderProjection = source('src/domain/cashierOrderProjection.ts');
  assert.doesNotMatch(orderProjection, /export\s*\{\s*projectCashierSalonTables\s*\}/);

  for (const path of [
    'src/components/caixa/settings/useCashierTableSettings.ts',
    'src/components/caixa/settings/CashierSettings.tsx',
    'src/components/caixa/pdv/useCashierPdv.ts',
    'src/components/caixa/pdv/CashierPdvView.tsx',
    'tests/sharedTableCard.test.ts',
    'tests/cashierOrderProjection.test.ts',
    'tests/cashierWorkspaceComponents.test.ts',
  ]) {
    const content = source(path);
    assert.match(content, /cashierSalonProjection/);
    assert.doesNotMatch(content, /projectCashierSalonTables[^\n]*cashierOrderProjection/);
  }
});
