import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('recomendações usam somente produtos e disponibilidade do catálogo atual', () => {
  const recommendations = source('../src/cardapio/components/CardapioRecommendations.tsx');
  assert.match(recommendations, /brand\.products/);
  assert.match(recommendations, /product\.isAvailable !== false/);
  assert.match(recommendations, /product\.category/);
  assert.doesNotMatch(recommendations, /fetch\(|localStorage|sessionStorage|historico|history/i);
});

test('recomendações cobrem bebida, sobremesa e adicional sem inventar produto ausente', () => {
  const recommendations = source('../src/cardapio/components/CardapioRecommendations.tsx');
  assert.match(recommendations, /'bebida', 'sobremesa', 'adicional'/);
  assert.match(recommendations, /Bebida/);
  assert.match(recommendations, /Sobremesa/);
  assert.match(recommendations, /Adicional/);
  assert.match(recommendations, /return product \? \[\{ kind, label: LABELS\[kind\], product \}\] : \[\]/);
  assert.match(recommendations, /if \(recommendations\.length === 0\) return null/);
});

test('home reutiliza cards canônicos e preços correntes do catálogo', () => {
  const recommendations = source('../src/cardapio/components/CardapioRecommendations.tsx');
  const conditions = source('../src/cardapio/components/CardapioOrderConditions.tsx');
  assert.match(recommendations, /product-card-\$\{product\.id\}/);
  assert.match(recommendations, /product\.price/);
  assert.match(recommendations, /cardapio-product-card__details-hitbox/);
  assert.match(conditions, /<CardapioRecommendations brand=\{brand\} \/>/);
});
