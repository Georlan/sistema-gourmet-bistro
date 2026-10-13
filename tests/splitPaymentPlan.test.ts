import assert from 'node:assert/strict';
import test from 'node:test';
import { splitPlanStatus } from '../src/components/caixa/checkout/splitPaymentPlan';

test('divide a conta em dinheiro, Pix e cartão usando centavos exatos', () => {
  const parts = [
    { id: 1, metodo: 'dinheiro' as const, valor: 10 },
    { id: 2, metodo: 'pix' as const, valor: 40.1 },
    { id: 3, metodo: 'cartao_debito' as const, valor: 109.9 },
  ];
  assert.deepEqual(splitPlanStatus(parts, 160), {
    plannedCents: 16000,
    differenceCents: 0,
    valid: true,
  });
  assert.equal(splitPlanStatus(parts.slice(1), 150).valid, true);
  assert.equal(splitPlanStatus(parts.slice(2), 109.9).valid, true);
});

test('não permite parte sem forma, valor vazio, negativo, excedente ou soma incompleta', () => {
  const base = [
    { id: 1, metodo: 'dinheiro' as const, valor: 10 },
    { id: 2, metodo: 'pix' as const, valor: 40 },
  ];
  assert.equal(splitPlanStatus(base, 100).valid, false);
  assert.equal(splitPlanStatus(base, 40).valid, false);
  assert.equal(splitPlanStatus([{ ...base[0], metodo: '' as const }, base[1]], 50).valid, false);
  assert.equal(splitPlanStatus([{ ...base[0], valor: '' as const }, base[1]], 40).valid, false);
  assert.equal(splitPlanStatus([{ ...base[0], valor: -10 }, base[1]], 30).valid, false);
  assert.equal(splitPlanStatus([{ ...base[0], valor: Number.POSITIVE_INFINITY }, base[1]], 50).valid, false);
  assert.equal(splitPlanStatus([{ ...base[0], valor: 10.001 }, base[1]], 50).valid, false);
  assert.equal(splitPlanStatus([], 0).valid, false);
});
