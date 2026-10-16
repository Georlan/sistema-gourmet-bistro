import test from 'node:test';
import assert from 'node:assert/strict';
import { customerBenefitDescription } from '../src/domain/customerBenefit';

test('CRM benefit objects become readable text without losing legacy descriptions', () => {
  assert.equal(customerBenefitDescription({explicacao:'120 pontos acumulados', saldo_acumulado_pontos:120}), '120 pontos acumulados');
  assert.equal(customerBenefitDescription('Saldo anterior'), 'Saldo anterior');
  assert.equal(customerBenefitDescription({explicacao_regra:'Regra anterior'}), 'Regra anterior');
});
test('missing or malformed benefit never becomes a React child object', () => {
  for (const value of [null, undefined, {}, {explicacao:{}}, 12]) {
    assert.equal(typeof customerBenefitDescription(value), 'string');
    assert.equal(customerBenefitDescription(value), 'Confira as regras na aba Benefícios.');
  }
});
