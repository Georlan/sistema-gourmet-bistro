import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('home consome ranking público cacheado e mantém catálogo como fonte de verdade', () => {
  const conditions = source('../src/cardapio/components/CardapioOrderConditions.tsx');
  const client = source('../src/cardapio/popularProductsClient.ts');
  assert.match(conditions, /fetchPopularProducts\(/);
  assert.match(client, /\/api\/cardapio-digital\/populares\?/);
  assert.match(conditions, /brand\.products\.map/);
  assert.match(conditions, /ids\.map\(\(id\) => byId\.get\(id\)\)/);
  assert.match(conditions, /rankedIds\.filter/);
  assert.doesNotMatch(conditions, /escolhas[^\n]*price|preco[^\n]*escolhas/i);
});

test('Mais escolhidos só renderiza quando o ranking resolve para produtos atuais', () => {
  const conditions = source('../src/cardapio/components/CardapioOrderConditions.tsx');
  assert.match(conditions, /if \(products\.length === 0\) return null/);
  assert.match(conditions, /id="popular-products-home"/);
  assert.match(conditions, />Mais escolhidos</);
  assert.match(conditions, /resolveCatalogDisplayProduct\(brand\.products, product, brand\.id\)/);
  assert.match(conditions, /product-card-\$\{displayProduct\.id\}/);
});

test('ranking é uma melhoria progressiva e falha sem bloquear a home', () => {
  const conditions = source('../src/cardapio/components/CardapioOrderConditions.tsx');
  const client = source('../src/cardapio/popularProductsClient.ts');
  assert.match(client, /if \(!response\.ok\) return \[\]/);
  assert.match(conditions, /cancelled = true/);
  assert.match(conditions, /setRankedIds\(\[\]\)/);
});
