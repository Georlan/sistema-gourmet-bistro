import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { PLAN_COMPARISON_MATRIX, SUBSCRIPTION_PLANS, getSubscriptionPricing } from '../src/config/subscriptionPlans';
const source = (path: string) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
test('landing renders exactly five commercial sections in narrative order', () => {
  const landing = source('src/landing/LandingPage.tsx');
  const sections = ['<Hero />', '<ValueStrip />', '<HowItWorks />', '<Plans />', '<FAQ />'];
  for (const section of sections) assert.ok(landing.includes(section));
  for (let i = 1; i < sections.length; i++) assert.ok(landing.indexOf(sections[i - 1]) < landing.indexOf(sections[i]));
  for (const old of ['<SocialProof />', '<Management />', '<Implementation />']) assert.equal(landing.includes(old), false);
});
test('comparison declares its example and old universal framing is absent', () => {
  const comparison = source('src/landing/sections/ValueStrip.tsx');
  assert.match(comparison, /Sem KÔMA.*exemplo/);
  assert.doesNotMatch(comparison, /OPERAÇÃO FRAGMENTADA|EXEMPLO: 4 REPASSES/);
});
test('plan prices, rates, annual computation and matrix use canonical contract', () => {
  const plans = source('src/landing/sections/Plans.tsx');
  assert.match(plans, /SUBSCRIPTION_PLANS|PLAN_COMPARISON_MATRIX|getSubscriptionPricing/);
  assert.doesNotMatch(plans, /CRESÇA PAGANDO MENOS|Mais recomendado/);
  assert.ok(PLAN_COMPARISON_MATRIX.length > 0);
  for (const plan of SUBSCRIPTION_PLANS) {
    const pricing = getSubscriptionPricing(plan.price);
    assert.equal(pricing.annualTotal, Math.round(plan.price * 12 * .9 * 100) / 100);
    assert.ok(plan.splitFeeRate > 0);
  }
  assert.ok(SUBSCRIPTION_PLANS[0].limitations.includes('Sem KDS e impressão automática'));
});
test('product screenshots and plan qualifications are real assets', () => {
  const tour = source('src/landing/sections/HowItWorks.tsx');
  for (const asset of ['pedidos.webp', 'cozinha.webp', 'cardapio.webp']) assert.ok(tour.includes(asset));
  assert.match(tour, /KDS dedicado e impressão automática no Pro e Premium/);
  assert.match(tour, /Cardápio Online incluído em todos os planos/);
});
test('landing SEO keeps canonical public root and advanced feature qualification', () => {
  const landing = source('src/landing/LandingPage.tsx');
  assert.match(landing, /canonical\.href = 'https:\/\/komafood\.com\.br\/'/);
  assert.match(landing, /KDS e impressão automática nos planos compatíveis/);
});
test('public landing loads directly with a commercial fallback, operational loader remains', () => {
  const main = source('src/main.tsx');
  assert.match(main, /isLandingEntryRoute[\s\S]*import\("\.\/landing\/LandingPage"\)/);
  assert.match(main, /isLandingEntryRoute[\s\S]*Pedidos, cozinha e caixa\. Um só fluxo/);
  assert.match(main, /<KomaLoading label="Preparando Kôma…" \/>/);
});
test('CSS reduces motion and keeps anchor targets below sticky header', () => {
  const css = source('src/landing/landing-v2.css');
  assert.match(css, /prefers-reduced-motion:reduce/);
  assert.match(css, /scroll-margin-top:88px/);
  assert.match(css, /@media\(max-width:359px\)/);
});
test('contract flow stays on public tenant domain and does not promise automatic Pix release', () => {
  const contract = source('src/legal/PlanContractPageV2.tsx');
  assert.doesNotMatch(contract, /activationResult\.slug\}\.koma\.com\.br/);
  assert.match(contract, /activationResult\.slug\}\.komafood\.com\.br/);
  assert.doesNotMatch(contract, /ativação acontece automaticamente/i);
});
