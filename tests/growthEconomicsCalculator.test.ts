import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = (path: string) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');

test('growth calculator delegates all economics to the authenticated backend', () => {
  const calculator = source('src/components/clientes/GrowthEconomicsCalculator.tsx');
  assert.match(calculator, /\/caixa\/cupons\/economia\/recomendacao/);
  assert.match(calculator, /authHeaders/);
  assert.match(calculator, /Split KÔMA/);
  assert.match(calculator, /Teto calculado/);
  assert.match(calculator, /Cashback é tratado como se 100% do crédito fosse resgatado/);
  assert.doesNotMatch(calculator, /Math\.random|openai|gemini|anthropic/i);
});

test('loyalty compact mode offers automatic or manual rates without asking the owner for CMV', () => {
  const calculator = source('src/components/clientes/GrowthEconomicsCalculator.tsx');
  const compactMode = calculator.slice(
    calculator.indexOf('if (compact)'),
    calculator.indexOf('const calculate = async'),
  );

  assert.match(compactMode, /Automático/);
  assert.match(compactMode, /Manual/);
  assert.match(compactMode, /mode:\s*'automatico'/);
  assert.match(compactMode, /Usar sugestão KÔMA/);
  assert.match(compactMode, /Nada é salvo até você tocar em “Salvar programa”/);
  assert.doesNotMatch(compactMode, /Ticket médio/);
  assert.doesNotMatch(compactMode, /Custos variáveis/);
  assert.doesNotMatch(compactMode, /Margem mínima/);
  assert.doesNotMatch(compactMode, /CMV/);
});

test('coupon recommendation only fills the existing canonical form and never auto-saves', () => {
  const cupons = source('src/components/clientes/CuponsTab.tsx');
  assert.match(cupons, /<GrowthEconomicsCalculator/);
  assert.match(cupons, /onApplyOption=\{handleApplyGrowthOption\}/);
  assert.match(cupons, /Sugestão aplicada ao formulário\. Revise e edite se quiser antes de salvar\./);

  const handler = cupons.slice(
    cupons.indexOf('const handleApplyGrowthOption'),
    cupons.indexOf('const handleSaveCupom'),
  );
  assert.match(handler, /setValorDesconto/);
  assert.match(handler, /setValorMinimo/);
  assert.doesNotMatch(handler, /fetch\(|handleSaveCupom|method:\s*['"]POST['"]/);
});

test('fixed coupon suggestion also fills a minimum order to protect the average-ticket economics', () => {
  const cupons = source('src/components/clientes/CuponsTab.tsx');
  const handler = cupons.slice(
    cupons.indexOf('const handleApplyGrowthOption'),
    cupons.indexOf('const handleSaveCupom'),
  );
  assert.match(handler, /fixed_discount_on_average_ticket/);
  assert.match(handler, /suggested_minimum_order_for_fixed_discount/);
});
