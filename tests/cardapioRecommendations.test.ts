import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('home V2 reutiliza MenuProductCard canônico e preços correntes do catálogo', () => {
  const v2 = source('../src/cardapio/v2/MenuV2Experience.tsx');
  const card = source('../src/cardapio/v2/MenuProductCard.tsx');
  assert.match(v2, /<MenuProductCard/);
  assert.match(card, /`product-card-\$\{product\.id\}`/);
  assert.match(card, /id=\{cardId\}/);
  assert.match(card, /effectivePrice/);
  assert.match(card, /onClick=\{\(\) => onSelectProduct\(product\)\}/);
});

test('módulo legado catalogRecommendations foi removido após unificação da vitrine V2', () => {
  assert.equal(existsSync(new URL('../src/cardapio/catalogRecommendations.ts', import.meta.url)), false);
});
