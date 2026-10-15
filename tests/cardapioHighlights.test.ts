import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { getCatalogHighlights } from '../src/cardapio/components/CardapioHighlights';
import type { Product } from '../src/cardapio/CardapioTypes';

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

const sampleProduct = (id: string, category: string, available = true): Product => ({
  id, category, name: id, description: '', price: 16, image: '', isAvailable: available,
});

test('promoções ativas aparecem antes dos populares sem limite de quatro', () => {
  const catalog = [
    sampleProduct('normal', 'Quentinhas'),
    sampleProduct('special', 'Destaques da casa'),
    ...Array.from({ length: 5 }, (_, i) => sampleProduct(`oferta-${i}`, 'Promoções')),
    sampleProduct('paused', 'Promoções', false),
  ];

  assert.deepEqual(
    getCatalogHighlights(catalog).map((product) => product.id),
    ['oferta-0', 'oferta-1', 'oferta-2', 'oferta-3', 'oferta-4'],
  );
});

test('sem promoções, mantém no máximo quatro destaques do catálogo vigente', () => {
  const catalog = Array.from({ length: 6 }, (_, i) => sampleProduct(`destaque-${i}`, 'Especiais'));
  assert.deepEqual(
    getCatalogHighlights(catalog).map((product) => product.id),
    ['destaque-0', 'destaque-1', 'destaque-2', 'destaque-3'],
  );
});
