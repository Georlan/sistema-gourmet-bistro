import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  SUBSCRIPTION_PLANS,
  getPlanAddons,
  getSubscriptionPricing,
  PLAN_COMPARISON_MATRIX,
} from '../src/config/subscriptionPlans';
import { Plans } from '../src/landing/sections/Plans';

test('plan prices and setup fees match the updated commercial catalog', () => {
  assert.deepEqual(SUBSCRIPTION_PLANS.map(plan => [plan.id, plan.price, plan.implementationFee]), [
    ['pocket', 119, 199], ['pro', 229, 199], ['premium', 329, 199],
  ]);
});

test('annual totals and savings apply ten percent only to the base subscription', () => {
  assert.deepEqual(SUBSCRIPTION_PLANS.map(plan => getSubscriptionPricing(plan.price)), [
    { monthly: 119, annualMonthlyEquivalent: 107.1, annualTotal: 1285.2, annualSavings: 142.8 },
    { monthly: 229, annualMonthlyEquivalent: 206.1, annualTotal: 2473.2, annualSavings: 274.8 },
    { monthly: 329, annualMonthlyEquivalent: 296.1, annualTotal: 3553.2, annualSavings: 394.8 },
  ]);
});

test('each plan lists all addons with the correct prices and inclusions', () => {
  for (const plan of SUBSCRIPTION_PLANS) {
    const addons = getPlanAddons(plan.id);
    assert.deepEqual(addons.map(addon => [addon.id, addon.price]), [
      ['online_menu', 49], ['delivery_app', 49], ['loyalty', 69],
    ]);
    assert.deepEqual(addons.map(addon => addon.included), {
      pocket: [false, false, false], pro: [true, false, false], premium: [true, true, true],
    }[plan.id]);
  }
});

test('manual delivery is available in all plans independently of the online menu', () => {
  const delivery = PLAN_COMPARISON_MATRIX.find(row => row.feature === 'Retirada e Delivery com Endereço, Taxa e Status');
  assert.ok(delivery);
  assert.deepEqual([delivery.pocket, delivery.pro, delivery.premium], [true, true, true]);
  const menu = PLAN_COMPARISON_MATRIX.find(row => row.feature === 'Cardápio Online & Pedidos via QR Code');
  assert.ok(menu);
  assert.deepEqual([menu.pro, menu.premium], [true, true]);
  assert.equal(typeof menu.pocket, 'string');
});

test('landing starts monthly without annual savings cards and displays all addons', () => {
  const html = renderToStaticMarkup(createElement(Plans));
  assert.equal(html.includes('koma-plan-savings'), false);
  assert.equal((html.match(/class="koma-plan-addons"/g) ?? []).length, 3);
  assert.equal((html.match(/Implantação:/g) ?? []).length, 3);
  assert.equal((html.match(/<dt>/g) ?? []).length, 9);
  for (const plan of SUBSCRIPTION_PLANS) {
    assert.ok(html.includes(`${plan.price},00 por mês`));
    for (const feature of plan.features) assert.ok(html.includes(feature));
  }
});

test('Pocket explains manual delivery and distinguishes the optional online menu', () => {
  const html = renderToStaticMarkup(createElement(Plans));
  const pocketCard = html.match(/<article aria-labelledby="plan-pocket-title"[\s\S]*?<\/article>/)?.[0];
  assert.ok(pocketCard);
  assert.ok(pocketCard.includes('Retirada e delivery com lançamento manual'));
  assert.ok(pocketCard.includes('Pedidos por WhatsApp ou telefone? Você lança no Kôma.'));
  assert.ok(pocketCard.includes('Com o cardápio digital opcional, o cliente pede pelo link.'));
  assert.ok(pocketCard.includes('Adicionais do Kôma Pocket'));
  assert.equal(pocketCard.includes('Delivery funciona mesmo sem'), false);
});
