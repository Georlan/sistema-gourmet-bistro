import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('destaques usam somente o catálogo atual e não criam nova fonte de verdade', () => {
  const highlights = source('../src/cardapio/components/CardapioHighlights.tsx');
  assert.match(highlights, /brand\.products/);
  assert.match(highlights, /product\.isAvailable !== false/);
  assert.match(highlights, /product\.category/);
  assert.doesNotMatch(highlights, /fetch\(|localStorage|sessionStorage|axios|API_BASE_URL/);
});

test('destaques reconhecem categorias promocionais sem inventar desconto', () => {
  const highlights = source('../src/cardapio/components/CardapioHighlights.tsx');
  for (const token of ['destaque', 'oferta', 'campanha', 'especial']) {
    assert.match(highlights, new RegExp(token));
  }
  assert.match(highlights, /slice\(0, 4\)/);
  assert.doesNotMatch(highlights, /desconto|economia|preço anterior|priceBefore/i);
});

test('home monta destaques antes de populares e recomendações', () => {
  const conditions = source('../src/cardapio/components/CardapioOrderConditions.tsx');
  assert.match(conditions, /CardapioHighlights/);
  assert.ok(conditions.indexOf('<CardapioHighlights') < conditions.indexOf('<PopularProductsPreview'));
  assert.ok(conditions.indexOf('<PopularProductsPreview') < conditions.indexOf('<CardapioRecommendations'));
});
