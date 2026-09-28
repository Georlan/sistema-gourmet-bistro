import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { KOMA_LANDING_CONFIG } from '../src/landing/config/landingConfig';
import { LeadCaptureModal } from '../src/landing/components/LeadCaptureModal';
import { LeadCaptureProvider } from '../src/landing/components/LeadCaptureProvider';
import { Plans } from '../src/landing/sections/Plans';
import { FAQ } from '../src/landing/sections/FAQ';
import { Hero } from '../src/landing/sections/Hero';
import { HowItWorks } from '../src/landing/sections/HowItWorks';
import { SUBSCRIPTION_PLANS, formatCurrency } from '../src/config/subscriptionPlans';

const source = (path: string) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
test('demo message needs only two fields and preserves selection', () => {
  const lead = { responsavel: 'Ana & João', estabelecimento: 'Café São José' };
  const message = KOMA_LANDING_CONFIG.getLeadMessage(lead, { plan: 'Kôma Pro', billing: 'anual' });
  assert.match(message, /demonstração.*sem compromisso/);
  assert.ok(message.includes('Kôma Pro · cobrança anual'));
  assert.equal(new URL(KOMA_LANDING_CONFIG.getLeadWhatsappUrl(lead)).hostname, 'wa.me');
});
test('demo remains a two-field native dialog', () => {
  const html = renderToStaticMarkup(createElement(LeadCaptureModal, { open: true, onClose() {} }));
  assert.ok(html.startsWith('<dialog'));
  assert.equal((html.match(/<input/g) ?? []).length, 2);
  assert.equal((html.match(/required=""/g) ?? []).length, 2);
  assert.ok(html.includes('Nenhum dado é enviado automaticamente.'));
});
test('hero uses canonical entry price and plain commercial copy', () => {
  const html = renderToStaticMarkup(createElement(Hero));
  assert.ok(html.includes('Pedidos, cozinha e caixa.'));
  assert.ok(html.includes(formatCurrency(Math.min(...SUBSCRIPTION_PLANS.map(p => p.price)))));
  assert.equal(html.includes('VENDA MAIS'), false);
});
test('plan links preserve monthly checkout and detailed matrix is collapsed', () => {
  const html = renderToStaticMarkup(createElement(LeadCaptureProvider, null, createElement(Plans)));
  for (const plan of SUBSCRIPTION_PLANS) {
    assert.ok(html.includes(`/contratar/${plan.id}?cobranca=mensal`));
    assert.ok(html.includes(formatCurrency(plan.price)));
  }
  assert.ok(html.includes('Comparar todos os recursos +'));
  assert.ok(html.includes('<details class="v2-plan-details"'));
  assert.equal(html.includes('Mais recomendado'), false);
});
test('FAQ consists of five closed questions', () => {
  const html = renderToStaticMarkup(createElement(FAQ));
  assert.equal((html.match(/<details>/g) ?? []).length, 5);
  assert.ok(html.includes('Quando começam os sete dias de teste?'));
  assert.ok(html.includes('não é plantão 24 horas'));
});
test('tour offers one active panel and accessible keyboard tabs', () => {
  const html = renderToStaticMarkup(createElement(HowItWorks));
  assert.equal((html.match(/role="tabpanel"/g) ?? []).length, 1);
  assert.equal((html.match(/role="tab"/g) ?? []).length, 3);
  assert.ok(html.includes('Pedidos por etapa.'));
  const tour = source('src/landing/sections/HowItWorks.tsx');
  for (const key of ['ArrowLeft', 'ArrowRight', 'Home', 'End']) assert.ok(tour.includes(key));
  assert.ok(tour.includes('KDS dedicado e impressão automática no Pro e Premium'));
});
test('header has no permanent WhatsApp CTA and mobile menu stays accessible', () => {
  const header = source('src/landing/sections/Header.tsx');
  assert.ok(header.includes('aria-controls="v2-mobile-nav"'));
  assert.ok(header.includes('Abrir menu'));
  assert.equal(header.includes('WhatsApp'), false);
});
