import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('home consome ranking público cacheado e mantém catálogo como fonte de verdade', () => {
  const v2 = source('../src/cardapio/v2/MenuV2Experience.tsx');
  const client = source('../src/cardapio/popularProductsClient.ts');
  assert.match(v2, /fetchPopularProducts\(/);
  assert.match(client, /\/api\/cardapio-digital\/populares\?/);
  assert.match(v2, /activeBrand\.products/);
  assert.match(v2, /byId\.get\(String\(id\)\)/);
  assert.match(v2, /effectivePopularIds/);
  assert.doesNotMatch(v2, /escolhas[^\n]*price|preco[^\n]*escolhas/i);
});

test('Mais escolhidos só renderiza quando o ranking resolve para produtos atuais', () => {
  const v2 = source('../src/cardapio/v2/MenuV2Experience.tsx');
  const card = source('../src/cardapio/v2/MenuProductCard.tsx');
  assert.match(v2, /highlightProducts\.length > 0/);
  assert.match(v2, /id="popular-products-home"/);
  assert.match(v2, />Destaques</);
  assert.match(v2, /resolveCatalogDisplayProduct\(catalog, source, activeBrand\.id\)/);
  assert.match(card, /id=\{`product-card-\$\{product\.id\}`\}/);
});

test('ranking é uma melhoria progressiva e falha sem bloquear a home', () => {
  const v2 = source('../src/cardapio/v2/MenuV2Experience.tsx');
  const client = source('../src/cardapio/popularProductsClient.ts');
  assert.match(client, /if \(!response\.ok\) return \[\]/);
  assert.match(v2, /cancelled = true/);
  assert.match(v2, /setPopularIds\(activeBrand\.popularProductIds \|\| \[\]\)/);
});
