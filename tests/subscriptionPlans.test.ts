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
  operationalEntitlementEnabled,
} from '../src/config/subscriptionPlans';
import { Plans } from '../src/landing/sections/Plans';

test('operational feature gates require an explicit backend entitlement', () => {
  assert.equal(operationalEntitlementEnabled(undefined, 'inventory'), false);
  assert.equal(operationalEntitlementEnabled({}, 'advanced_reports'), false);
  assert.equal(operationalEntitlementEnabled({ inventory: false }, 'inventory'), false);
  assert.equal(operationalEntitlementEnabled({ inventory: true }, 'inventory'), true);
  assert.equal(operationalEntitlementEnabled({ advanced_reports: true }, 'advanced_reports'), true);
});

test('plan prices and split fees match the commercial catalog', () => {
  assert.deepEqual(SUBSCRIPTION_PLANS.map(plan => [plan.id, plan.price, plan.splitFeeRate]), [
    ['pocket', 39, 0.0179],
    ['pro', 129, 0.005],
    ['premium', 249, 0.002],
  ]);
  assert.deepEqual(SUBSCRIPTION_PLANS.map(plan => formatPercentage(plan.splitFeeRate)), [
    '1,79%', '0,50%', '0,20%',
  ]);
});

test('Pocket has fixed revenue without online payments and crosses Pro near R$ 6.977 online', () => {
  const [pocket, pro] = SUBSCRIPTION_PLANS;
  const total = (price: number, rate: number, volume: number) => price + rate * volume;
  assert.equal(total(pocket.price, pocket.splitFeeRate, 0), 39);
  assert.ok(total(pocket.price, pocket.splitFeeRate, 5_000) < total(pro.price, pro.splitFeeRate, 5_000));
  assert.ok(total(pocket.price, pocket.splitFeeRate, 10_000) > total(pro.price, pro.splitFeeRate, 10_000));
  assert.equal(Number(((pro.price - pocket.price) / (pocket.splitFeeRate - pro.splitFeeRate)).toFixed(2)), 6976.74);
});

test('annual totals and savings apply ten percent only to the fixed subscription', () => {
  assert.deepEqual(SUBSCRIPTION_PLANS.map(plan => getSubscriptionPricing(plan.price)), [
    { monthly: 39, annualMonthlyEquivalent: 35.1, annualTotal: 421.2, annualSavings: 46.8 },
    { monthly: 129, annualMonthlyEquivalent: 116.1, annualTotal: 1393.2, annualSavings: 154.8 },
    { monthly: 249, annualMonthlyEquivalent: 224.1, annualTotal: 2689.2, annualSavings: 298.8 },
  ]);
});

test('delivery, waiter app and team management stay in every plan while advanced modules require upgrade', () => {
  const delivery = PLAN_COMPARISON_MATRIX.find(row => row.feature === 'Retirada e Delivery com Endereço, Taxa e Status');
  assert.ok(delivery);
  assert.deepEqual([delivery.pocket, delivery.pro, delivery.premium], [true, true, true]);

  const waiterApp = PLAN_COMPARISON_MATRIX.find(row => row.feature === 'App do Garçom para Salão e Comandas');
  assert.ok(waiterApp);
  assert.deepEqual([waiterApp.pocket, waiterApp.pro, waiterApp.premium], [true, true, true]);

  const teamManagement = PLAN_COMPARISON_MATRIX.find(row => row.feature === 'Gestão de Funcionários e Permissões por Cargo');
  assert.ok(teamManagement);
  assert.deepEqual([teamManagement.pocket, teamManagement.pro, teamManagement.premium], [true, true, true]);

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
  assert.deepEqual([fee.pocket, fee.pro, fee.premium], ['1,79%', '0,50%', '0,20%']);
});

test('landing starts monthly, has no setup fee or addons, and shows all current prices and split fees', () => {
  const html = renderToStaticMarkup(createElement(Plans));
  assert.equal(html.includes('koma-plan-savings'), false);
  assert.equal(html.includes('89,00 por mês'), false);
  assert.equal(html.includes('179,00 por mês'), false);
  assert.equal(html.includes('269,00 por mês'), false);
  assert.equal(html.includes('Adicionais do'), false);
  assert.ok(html.includes('SEM TAXA DE IMPLANTAÇÃO'));
  assert.ok(html.includes('Sem add-ons'));
  assert.ok(html.includes('MAIS RECOMENDADO'));
  assert.ok(html.includes('MENOR TAXA'));
  assert.ok(html.includes('Cardápio digital, mesas, equipe, App do Garçom e delivery já começam no Pocket.'));
  assert.ok(SUBSCRIPTION_PLANS.find(plan => plan.id === 'pocket')?.features.includes('App do Garçom para salão e comandas'));
  assert.ok(SUBSCRIPTION_PLANS.find(plan => plan.id === 'pocket')?.features.includes('Equipe, funções e permissões por cargo'));

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


test('annual discount applies to fixed price in Pocket, Pro and Premium', () => {
  const pocket = getSubscriptionPricing(39);
  const pro = getSubscriptionPricing(129);
  const premium = getSubscriptionPricing(249);
  assert.equal(pocket.monthly, 39);
  assert.equal(pocket.annualTotal, 421.2);
  assert.equal(pocket.annualMonthlyEquivalent, 35.1);
  assert.equal(pocket.annualSavings, 46.8);
  assert.equal(pro.annualTotal, 1393.2);
  assert.equal(pro.annualMonthlyEquivalent, 116.1);
  assert.equal(premium.annualTotal, 2689.2);
  assert.equal(premium.annualMonthlyEquivalent, 224.1);

  const html = renderToStaticMarkup(createElement(Plans));
  assert.ok(html.includes('Sem taxa de implantação'));
  assert.ok(html.includes('1,79%'));
  assert.ok(html.includes('Seu restaurante cresceu. Sua taxa diminui.'));
  assert.ok(html.includes('Mais volume, menor taxa.'));
});
