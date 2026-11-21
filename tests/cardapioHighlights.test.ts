import { register } from 'node:module';
register('./helpers/staticAssetsLoader.mjs', import.meta.url);
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
const { getCatalogHighlights } = await import('../src/cardapio/catalogHighlights');
import type { Product } from '../src/cardapio/CardapioTypes';

const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('destaques usam somente o catálogo atual e não criam nova fonte de verdade', () => {
  const highlights = source('../src/cardapio/catalogHighlights.ts');
  const v2 = source('../src/cardapio/v2/MenuV2Experience.tsx');
  assert.match(highlights, /product\.isAvailable !== false/);
  assert.match(highlights, /product\.category/);
  assert.match(v2, /activeBrand\.products/);
  assert.doesNotMatch(highlights, /fetch\(|localStorage|sessionStorage|axios|API_BASE_URL/);
});

test('destaques reconhecem categorias promocionais sem inventar desconto', () => {
  const highlights = source('../src/cardapio/catalogHighlights.ts');
  for (const token of ['destaque', 'oferta', 'campanha', 'especial']) {
    assert.match(highlights, new RegExp(token));
  }
  assert.match(highlights, /slice\(0, 4\)/);
  assert.doesNotMatch(highlights, /desconto|economia|preço anterior|priceBefore/i);
});

test('home prioriza ranking real e mantém a vitrine antes do catálogo', () => {
  const v2 = source('../src/cardapio/v2/MenuV2Experience.tsx');
  assert.ok(v2.indexOf('id="koma-art-hero-showcase"') < v2.indexOf('id="popular-products-home"'));
  assert.ok(v2.indexOf('id="popular-products-home"') < v2.indexOf('id="catalog-feed"'));
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
