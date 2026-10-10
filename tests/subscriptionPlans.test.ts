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
    ['pocket', 79.9, 0],
    ['pro', 179.9, 0],
    ['premium', 329.9, 0],
  ]);
  assert.deepEqual(SUBSCRIPTION_PLANS.map(plan => formatPercentage(plan.splitFeeRate)), [
    '0,00%', '0,00%', '0,00%',
  ]);
});

test('online order volume never adds KOMA commission to current plans', () => {
  for (const plan of SUBSCRIPTION_PLANS) {
    for (const volume of [0, 5_000, 10_000, 1_000_000]) {
      assert.equal(plan.price + plan.splitFeeRate * volume, plan.price);
    }
  }
});

test('annual totals and savings apply ten percent only to the fixed subscription', () => {
  assert.deepEqual(SUBSCRIPTION_PLANS.map(plan => getSubscriptionPricing(plan.price)), [
    { monthly: 79.9, annualMonthlyEquivalent: 71.91, annualTotal: 862.92, annualSavings: 95.88 },
    { monthly: 179.9, annualMonthlyEquivalent: 161.91, annualTotal: 1942.92, annualSavings: 215.88 },
    { monthly: 329.9, annualMonthlyEquivalent: 296.91, annualTotal: 3562.92, annualSavings: 395.88 },
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
  assert.deepEqual([fee.pocket, fee.pro, fee.premium], ['0%', '0%', '0%']);
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
  assert.ok(html.includes('GESTÃO COMPLETA'));
  assert.ok(html.includes('Cardápio digital, mesas, equipe, App do Garçom e delivery já começam no Pocket.'));
  assert.ok(SUBSCRIPTION_PLANS.find(plan => plan.id === 'pocket')?.features.includes('App do Garçom para salão e comandas'));
  assert.ok(SUBSCRIPTION_PLANS.find(plan => plan.id === 'pocket')?.features.includes('Equipe, funções e permissões por cargo'));

  for (const plan of SUBSCRIPTION_PLANS) {
    assert.ok(html.includes(`${plan.price.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} por mês`));
    assert.ok(html.includes('0%'));
    for (const feature of plan.features) assert.ok(html.includes(feature));
  }
});

test('landing explains that the variable fee only applies to paid online orders', () => {
  const html = renderToStaticMarkup(createElement(Plans));
  assert.ok(html.includes('0% de comissão KÔMA.'));
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
  const pocket = getSubscriptionPricing(79.9);
  const pro = getSubscriptionPricing(179.9);
  const premium = getSubscriptionPricing(329.9);
  assert.equal(pocket.monthly, 79.9);
  assert.equal(pocket.annualTotal, 862.92);
  assert.equal(pocket.annualMonthlyEquivalent, 71.91);
  assert.equal(pocket.annualSavings, 95.88);
  assert.equal(pro.annualTotal, 1942.92);
  assert.equal(pro.annualMonthlyEquivalent, 161.91);
  assert.equal(premium.annualTotal, 3562.92);
  assert.equal(premium.annualMonthlyEquivalent, 296.91);

  const html = renderToStaticMarkup(createElement(Plans));
  assert.ok(html.includes('Sem taxa de implantação'));
  assert.ok(html.includes('0%'));
  assert.ok(html.includes('Gestão profissional, com 0% de comissão KÔMA.'));
  assert.ok(html.includes('Gestão completa, entregadores e fidelização, com 0% de comissão KÔMA.'));
});
