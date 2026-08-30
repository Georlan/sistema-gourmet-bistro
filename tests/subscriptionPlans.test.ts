import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  SUBSCRIPTION_PLANS,
  getPlanAddons,
  getSubscriptionPricing,
  PLAN_COMPARISON_MATRIX,
  getPremiumBundleComparison,
  isAddonIncludedInPlan,
  normalizeSubscriptionPlan,
} from '../src/config/subscriptionPlans';
import { Plans } from '../src/landing/sections/Plans';

test('plan prices and setup fees match the updated commercial catalog', () => {
  assert.deepEqual(SUBSCRIPTION_PLANS.map(plan => [plan.id, plan.price, plan.implementationFee]), [
    ['pocket', 99, 199], ['pro', 189, 199], ['premium', 279, 199],
  ]);
});

test('annual totals and savings apply ten percent only to the base subscription', () => {
  assert.deepEqual(SUBSCRIPTION_PLANS.map(plan => getSubscriptionPricing(plan.price)), [
    { monthly: 99, annualMonthlyEquivalent: 89.1, annualTotal: 1069.2, annualSavings: 118.8 },
    { monthly: 189, annualMonthlyEquivalent: 170.1, annualTotal: 2041.2, annualSavings: 226.8 },
    { monthly: 279, annualMonthlyEquivalent: 251.1, annualTotal: 3013.2, annualSavings: 334.8 },
  ]);
});

test('each plan lists all addons with the correct prices and inclusions', () => {
  for (const plan of SUBSCRIPTION_PLANS) {
    const addons = getPlanAddons(plan.id);
    assert.deepEqual(addons.map(addon => [addon.id, addon.price]), [
      ['online_menu', 0], ['delivery_app', 59], ['loyalty', 59],
    ]);
    assert.deepEqual(addons.map(addon => addon.included), {
      pocket: [true, false, false], pro: [true, false, false], premium: [true, true, true],
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
  assert.equal(menu.pocket, true);
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

test('Pocket explains online and manual delivery with the menu included', () => {
  const html = renderToStaticMarkup(createElement(Plans));
  const pocketCard = html.match(/<article aria-labelledby="plan-pocket-title"[\s\S]*?<\/article>/)?.[0];
  assert.ok(pocketCard);
  assert.ok(pocketCard.includes('Retirada e delivery no mesmo caixa'));
  assert.ok(pocketCard.includes('Por WhatsApp ou telefone, você lança manualmente.'));
  assert.ok(pocketCard.includes('Pelo link, o cliente envia o pedido ao Kôma.'));
  assert.ok(pocketCard.includes('Não precisa contratar o app do entregador.'));
  assert.equal(pocketCard.includes('cardápio digital opcional'), false);
  assert.ok(pocketCard.includes('Adicionais do Kôma Pocket'));
  assert.equal(pocketCard.includes('Delivery funciona mesmo sem'), false);
});

test('Premium bundle comparison uses equal billing cycles and undiscounted addons', () => {
  assert.deepEqual(getPremiumBundleComparison(), { separatePrice: 307, bundlePrice: 279, monthlySavings: 28 });
  assert.deepEqual(getPremiumBundleComparison(true), { separatePrice: 288.1, bundlePrice: 251.1, monthlySavings: 37 });
  const pro = SUBSCRIPTION_PLANS.find(plan => plan.id === 'pro')!;
  const premium = SUBSCRIPTION_PLANS.find(plan => plan.id === 'premium')!;
  for (const yearly of [false, true]) {
    const price = (value: number) => yearly ? getSubscriptionPricing(value).annualMonthlyEquivalent : value;
    for (const addon of getPlanAddons('pro').filter(addon => !addon.included)) {
      // One optional module remains cheaper than the full bundle by at least R$20.
      assert.ok(price(premium.price) - (price(pro.price) + addon.price) >= 20);
    }
  }
});

test('online-menu access follows the catalog and preserves legacy plan inclusions', () => {
  for (const plan of ['pocket', 'pro', 'premium', 'bistro', 'delivery', 'gold', 'platinum']) {
    assert.equal(isAddonIncludedInPlan(normalizeSubscriptionPlan(plan), 'online_menu'), true);
  }
  assert.equal(isAddonIncludedInPlan('pocket', 'delivery_app'), false);
  assert.equal(isAddonIncludedInPlan('pro', 'loyalty'), false);
  assert.equal(isAddonIncludedInPlan('premium', 'delivery_app'), true);
});

test('landing does not sell the included menu or promise unimplemented paid modules', () => {
  const html = renderToStaticMarkup(createElement(Plans));
  assert.equal(html.includes('R$ 0,00'), false);
  assert.match(html, /No Premium, você paga R\$\s28,00 a menos por mês\./);
  assert.ok(html.includes('Emissão fiscal, pagamento online e integração com marketplaces não fazem parte desta oferta.'));
  assert.equal(PLAN_COMPARISON_MATRIX.some(row => row.category === 'Notificações'), false);
});
