import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  SUBSCRIPTION_PLANS,
  getSubscriptionPricing,
  PLAN_COMPARISON_MATRIX,
  formatPercentage,
  normalizeSubscriptionPlan,
} from '../src/config/subscriptionPlans';
import { Plans } from '../src/landing/sections/Plans';

test('plan prices and split fees match the commercial catalog', () => {
  assert.deepEqual(SUBSCRIPTION_PLANS.map(plan => [plan.id, plan.price, plan.splitFeeRate]), [
    ['pocket', 89, 0.0179],
    ['pro', 179, 0.0089],
    ['premium', 269, 0.0039],
  ]);
  assert.deepEqual(SUBSCRIPTION_PLANS.map(plan => formatPercentage(plan.splitFeeRate)), [
    '1,79%', '0,89%', '0,39%',
  ]);
});

test('annual totals and savings apply ten percent only to the fixed subscription', () => {
  assert.deepEqual(SUBSCRIPTION_PLANS.map(plan => getSubscriptionPricing(plan.price)), [
    { monthly: 89, annualMonthlyEquivalent: 80.1, annualTotal: 961.2, annualSavings: 106.8 },
    { monthly: 179, annualMonthlyEquivalent: 161.1, annualTotal: 1933.2, annualSavings: 214.8 },
    { monthly: 269, annualMonthlyEquivalent: 242.1, annualTotal: 2905.2, annualSavings: 322.8 },
  ]);
});

test('essential delivery stays in every plan while advanced modules require upgrade', () => {
  const delivery = PLAN_COMPARISON_MATRIX.find(row => row.feature === 'Retirada e Delivery com Endereço, Taxa e Status');
  assert.ok(delivery);
  assert.deepEqual([delivery.pocket, delivery.pro, delivery.premium], [true, true, true]);

  const courierApp = PLAN_COMPARISON_MATRIX.find(row => row.feature === 'App do Entregador');
  assert.ok(courierApp);
  assert.deepEqual([courierApp.pocket, courierApp.pro, courierApp.premium], [false, false, true]);

  const loyalty = PLAN_COMPARISON_MATRIX.find(row => row.feature === 'Pontos, Cashback e Cupons');
  assert.ok(loyalty);
  assert.deepEqual([loyalty.pocket, loyalty.pro, loyalty.premium], [false, false, true]);
});

test('comparison matrix publishes the exact KOMA online-payment fee by plan', () => {
  const fee = PLAN_COMPARISON_MATRIX.find(row => row.feature === 'Taxa KÔMA por pedido online pago');
  assert.ok(fee);
  assert.deepEqual([fee.pocket, fee.pro, fee.premium], ['1,79%', '0,89%', '0,39%']);
});

test('landing starts monthly, has no setup fee or addons, and shows all split fees', () => {
  const html = renderToStaticMarkup(createElement(Plans));
  assert.equal(html.includes('koma-plan-savings'), false);
  assert.equal(html.includes('R$ 199'), false);
  assert.equal(html.includes('Adicionais do'), false);
  assert.ok(html.includes('SEM TAXA DE IMPLANTAÇÃO'));
  assert.ok(html.includes('Sem add-ons'));
  assert.ok(html.includes('MAIS RECOMENDADO'));
  assert.ok(html.includes('MENOR TAXA'));

  for (const plan of SUBSCRIPTION_PLANS) {
    assert.ok(html.includes(`${plan.price},00 por mês`));
    assert.ok(html.includes(formatPercentage(plan.splitFeeRate)));
    for (const feature of plan.features) assert.ok(html.includes(feature));
  }
});

test('landing explains that the variable fee only applies to paid online orders', () => {
  const html = renderToStaticMarkup(createElement(Plans));
  assert.ok(html.includes('Você só paga essa taxa quando recebe um pedido online pago pelo sistema.'));
  assert.ok(html.includes('custos do provedor de pagamento são separados'));
  assert.ok(html.includes('a taxa por pedido permanece igual'));
});

test('legacy plan names still normalize to Premium without reintroducing addons', () => {
  assert.equal(normalizeSubscriptionPlan('pocket'), 'pocket');
  assert.equal(normalizeSubscriptionPlan('pro'), 'pro');
  assert.equal(normalizeSubscriptionPlan('premium'), 'premium');
  for (const plan of ['bistro', 'delivery', 'gold', 'platinum']) {
    assert.equal(normalizeSubscriptionPlan(plan), 'premium');
  }
  assert.equal(normalizeSubscriptionPlan('unknown'), 'pocket');
});

test('landing does not promise unrelated modules as part of the commercial offer', () => {
  const html = renderToStaticMarkup(createElement(Plans));
  assert.ok(html.includes('Emissão fiscal e integração com marketplaces não fazem parte desta oferta.'));
  assert.equal(PLAN_COMPARISON_MATRIX.some(row => row.category === 'Notificações'), false);
});
