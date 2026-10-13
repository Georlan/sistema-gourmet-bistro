import test from 'node:test';
import assert from 'node:assert/strict';
import { menuReportCsv, simulationMoneyInput, simulationQuantityInput, type MenuReport } from '../src/domain/menuIntelligence';

test('simulation rejects unknown cost, fractional units and nonfinite or exponent money', () => {
  for (const value of ['', 'NaN', 'Infinity', '-1', '1e3', '1.001', '1000001']) assert.equal(simulationMoneyInput(value), null);
  assert.equal(simulationMoneyInput('11,50'), '11.50');
  assert.equal(simulationMoneyInput('0'), '0.00'); // explicit manual assumption; not missing
  for (const value of ['', '-1', '1.5', '1e2', '1000001']) assert.equal(simulationQuantityInput(value), null);
  assert.equal(simulationQuantityInput('54'), 54);
});

test('export names are spreadsheet-safe and unknown contributions remain blank', () => {
  const report: MenuReport = { inicio_anterior: '2026-09-01', fim_anterior: '2026-09-30', unidades: 10, produtos: [{
    produto_id: 'a', nome: '=CMD("x")', categoria: '@malicious', ativo: true, unidades: 10, unidades_anteriores: 5,
    variacao_pct: 100, participacao_pct: 100, preco_medio: 10, preco_cardapio: 10, custo_unitario: null,
    margem_unitaria_cardapio: null, margem_pct_cardapio: null, sugestoes: [], contribuicao_estimada: null,
  }] };
  const csv = menuReportCsv(report, '2026-10-01', '2026-10-31');
  assert.ok(csv.includes("'=")); assert.ok(csv.includes("'@")); assert.ok(csv.includes('2026-10-01'));
  assert.ok(csv.includes('Não é lucro histórico'));
  assert.ok(csv.includes(';10;5;;;;;;"Não classificável"'));
});
