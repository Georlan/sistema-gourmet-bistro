import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_LOYALTY_CONFIG, effectiveLoyaltyPercent, loyaltyConfigEqual, parseLoyaltyConfig,
} from '../src/components/caixa/customers/useLoyaltyConfiguration';

test('server config is strict and cannot be confused with malformed or missing data', () => {
  const saved = parseLoyaltyConfig({ ativo: true, tipo_recompensa:'PONTOS',
    taxa_conversao:1, valor_ponto_em_dinheiro:0.05, id:1 });
  assert.deepEqual(saved, { ativo: true, tipo_recompensa:'PONTOS', taxa_conversao:1, valor_ponto_em_dinheiro:0.05 });
  for (const data of [null,{}, {...saved, taxa_conversao:Infinity},
    {...saved, taxa_conversao:-1}, {...saved, tipo_recompensa:'INVENTADO'}, {...saved, ativo:null}]) {
    assert.throws(() => parseLoyaltyConfig(data));
  }
});
test('cashback and points share equivalent incentive but retained points may change redemption value', () => {
  assert.equal(effectiveLoyaltyPercent({ ...DEFAULT_LOYALTY_CONFIG, ativo:true }), 5);
  assert.equal(effectiveLoyaltyPercent({ ...DEFAULT_LOYALTY_CONFIG, ativo:true,
    tipo_recompensa:'CASHBACK', taxa_conversao:2 }), 2);
  assert.equal(effectiveLoyaltyPercent(DEFAULT_LOYALTY_CONFIG), 0);
  assert.equal(loyaltyConfigEqual(DEFAULT_LOYALTY_CONFIG, { ...DEFAULT_LOYALTY_CONFIG }), true);
  assert.equal(loyaltyConfigEqual(DEFAULT_LOYALTY_CONFIG, { ...DEFAULT_LOYALTY_CONFIG, ativo:true }), false);
});
