import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('home consome ranking público cacheado e mantém catálogo como fonte de verdade', () => {
  const conditions = source('../src/cardapio/components/CardapioOrderConditions.tsx');
  assert.match(conditions, /\/api\/cardapio-digital\/populares\?restaurante_id=/);
  assert.match(conditions, /brand\.products\.map/);
  assert.match(conditions, /rankedIds\.map/);
  assert.doesNotMatch(conditions, /escolhas[^\n]*price|preco[^\n]*escolhas/i);
});

test('Mais escolhidos só renderiza quando o ranking resolve para produtos atuais', () => {
  const conditions = source('../src/cardapio/components/CardapioOrderConditions.tsx');
  assert.match(conditions, /if \(products\.length === 0\) return null/);
  assert.match(conditions, /id="popular-products-home"/);
  assert.match(conditions, />Mais escolhidos</);
  assert.match(conditions, /product-card-\$\{product\.id\}/);
});

test('ranking é uma melhoria progressiva e falha sem bloquear a home', () => {
  const conditions = source('../src/cardapio/components/CardapioOrderConditions.tsx');
  assert.match(conditions, /if \(!response\.ok\) return null/);
  assert.match(conditions, /AbortController/);
  assert.match(conditions, /setRankedIds\(\[\]\)/);
});
