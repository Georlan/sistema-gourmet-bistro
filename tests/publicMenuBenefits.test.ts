import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const v2Source = readFileSync(
  new URL('../src/cardapio/v2/MenuV2Experience.tsx', import.meta.url),
  'utf8',
);
const pageSource = readFileSync(
  new URL('../src/cardapio/CardapioPage.tsx', import.meta.url),
  'utf8',
);
const benefitsSource = readFileSync(
  new URL('../src/cardapio/components/CardapioBenefitsDrawer.tsx', import.meta.url),
  'utf8',
);

test('public menu keeps benefits entry points for mobile and desktop', () => {
  assert.match(v2Source, /id="btn-benefits-header"/);
  assert.match(v2Source, /id="mobile-nav-benefits"/);
  assert.match(pageSource, /<CardapioBenefitsDrawer/);
});

test('benefits are refreshed when the drawer opens', () => {
  assert.match(benefitsSource, /if \(!isOpen \|\| !restaurantKey\) return;/);
  assert.match(benefitsSource, /\/cardapio\/cupons\/beneficios\?/);
  assert.match(benefitsSource, /cache: "no-store"/);
});

test('benefits keep Koma terminology instead of mirroring the reference product', () => {
  assert.match(benefitsSource, /label: "Ofertas"/);
  assert.match(benefitsSource, /label: "Créditos"/);
  assert.match(benefitsSource, /label: "Pontos"/);
  assert.doesNotMatch(benefitsSource, />Cupom</);
  assert.doesNotMatch(benefitsSource, />Cashback</);
  assert.doesNotMatch(benefitsSource, />Fidelidade</);
});
