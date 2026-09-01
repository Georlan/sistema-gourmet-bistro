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

test('demo message needs only two fields and preserves plan and billing selection', () => {
  const lead = { responsavel: '  Ana & João  ', estabelecimento: '  Café São José  ' };
  const selection = { plan: 'Kôma Pro', billing: 'anual' as const };
  const message = KOMA_LANDING_CONFIG.getLeadMessage(lead, selection);
  assert.match(message, /demonstração.*sem compromisso/);
  assert.ok(message.includes('Responsável: Ana & João'));
  assert.ok(message.includes('Estabelecimento: Café São José'));
  assert.ok(message.includes('Kôma Pro · cobrança anual'));
  assert.equal(message.includes('undefined'), false);
  assert.equal(message.includes('WhatsApp:'), false);
  const url = new URL(KOMA_LANDING_CONFIG.getLeadWhatsappUrl(lead, selection));
  assert.equal(url.hostname, 'wa.me');
  assert.equal(url.searchParams.get('text'), message);
  assert.equal(KOMA_LANDING_CONFIG.getLeadMessage(lead).includes('Plano de interesse'), false);
});

test('demo uses a native dialog and only two required inputs, not a signup form', () => {
  const html = renderToStaticMarkup(createElement(LeadCaptureModal, { open: true, onClose() {}, selection: { plan: 'Kôma Pocket', billing: 'mensal' } }));
  assert.ok(html.startsWith('<dialog'));
  assert.equal((html.match(/<input/g) ?? []).length, 2);
  assert.equal((html.match(/required=""/g) ?? []).length, 2);
  assert.ok(html.includes('pattern=".*\\S.*"'));
  assert.ok(html.includes('Isso não é uma contratação.'));
  assert.ok(html.includes('Nenhum dado é enviado automaticamente.'));
  assert.ok(html.includes('aria-describedby='));
  assert.ok(html.includes('role="status"'));
  assert.equal(renderToStaticMarkup(createElement(LeadCaptureModal, { open: false, onClose() {} })), '');
});

test('plan choices are buttons connected to the shared demo, and savings stay conditional', () => {
  const html = renderToStaticMarkup(createElement(LeadCaptureProvider, null, createElement(Plans)));
  for (const name of ['POCKET', 'PRO', 'PREMIUM']) {
    assert.match(html, new RegExp('<button[^>]*>ESCOLHER ' + name + '</button>'));
  }
  assert.equal(html.includes('href="#cadastro"'), false);
  assert.equal(html.includes('koma-plan-savings'), false);
  assert.equal((html.match(/class="koma-plan-addons"/g) ?? []).length, 3);
});

test('FAQ starts closed and explains delivery, pricing, internet and support without new promises', () => {
  const html = renderToStaticMarkup(createElement(FAQ));
  assert.equal((html.match(/<details>/g) ?? []).length, 6);
  assert.equal(html.includes('<details open'), false);
  assert.ok(html.includes('inclusive no Pocket'));
  assert.ok(html.includes('O app do entregador faz parte do Premium'));
  assert.ok(html.includes('não cobra taxa de implantação'));
  assert.ok(html.includes('não vende add-ons'));
  assert.ok(html.includes('não é plantão 24 horas'));
});

test('tour and device structure protect compact responsive layout and keyboard navigation', () => {
  const tour = readFileSync(new URL('../src/landing/sections/HowItWorks.tsx', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../src/landing/mobile-refinement.css', import.meta.url), 'utf8');
  const landing = readFileSync(new URL('../src/landing/LandingPage.tsx', import.meta.url), 'utf8');
  assert.ok(tour.includes('role="tablist"'));
  assert.ok(tour.includes('hidden={active !== index}'));
  assert.ok(tour.includes('aria-controls={screen.id}'));
  for (const key of ['ArrowLeft', 'ArrowRight', 'Home', 'End']) assert.ok(tour.includes(key));
  assert.ok(tour.includes("addEventListener('hashchange'"));
  assert.match(css, /\.koma-frontal-canvas\s*\{[^}]*position: absolute/);
  assert.match(css, /\.koma-tour-panel\[hidden\]\s*\{\s*display: none/);
  assert.equal(landing.includes('<Capabilities />'), false);
  assert.ok(landing.indexOf('<Plans />') < landing.indexOf('<FAQ />'));
});

test('tour removes the illustration caption and scales only tablet and phone frames', () => {
  const tour = readFileSync(new URL('../src/landing/sections/HowItWorks.tsx', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../src/landing/mobile-refinement.css', import.meta.url), 'utf8');
  assert.equal(tour.includes('Prévia ilustrativa'), false);
  assert.equal(tour.includes('<figcaption>'), false);
  assert.ok(tour.includes('aria-label={`Kôma · ${screen.label}`}'));
  assert.match(css, /\.koma-tour-device \.koma-editable-tablet\s*\{\s*width: min\(84%, 560px\)/);
  assert.match(css, /\.koma-tour-device \.koma-editable-phone\s*\{\s*width: min\(100%, 192px\)/);
  assert.match(css, /@media \(max-width: 768px\)[\s\S]*\.koma-tour-device \.koma-editable-phone\s*\{\s*width: min\(100%, 176px\)/);
  assert.equal(css.includes('.koma-tour-device .koma-editable-laptop'), false);
});
