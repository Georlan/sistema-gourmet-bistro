import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const headerSource = readFileSync(
  new URL('../src/cardapio/components/CardapioHeader.tsx', import.meta.url),
  'utf8',
);
const benefitsSource = readFileSync(
  new URL('../src/cardapio/components/CardapioBenefitsDrawer.tsx', import.meta.url),
  'utf8',
);

test('public menu exposes a Koma benefits entry from the header', () => {
  assert.match(headerSource, /id="btn-benefits-header"/);
  assert.match(headerSource, /CardapioBenefitsDrawer/);
  assert.match(headerSource, />Benefícios</);
});

test('benefits are loaded only after the drawer opens', () => {
  assert.match(benefitsSource, /if \(!isOpen \|\| !restaurantKey \|\| loadedRestaurantId === restaurantKey\) return;/);
  assert.match(benefitsSource, /\/cardapio\/cupons\/beneficios\?/);
});

test('benefits keep Koma terminology instead of mirroring the reference product', () => {
  assert.match(benefitsSource, /label: "Ofertas"/);
  assert.match(benefitsSource, /label: "Créditos"/);
  assert.match(benefitsSource, /label: "Pontos"/);
  assert.doesNotMatch(benefitsSource, />Cupom</);
  assert.doesNotMatch(benefitsSource, />Cashback</);
  assert.doesNotMatch(benefitsSource, />Fidelidade</);
});
