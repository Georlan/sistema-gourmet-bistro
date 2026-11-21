import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

const v2 = source('../src/cardapio/v2/MenuV2Experience.tsx');
const card = source('../src/cardapio/v2/MenuProductCard.tsx');

test('Hero mais pedido e destaques acionam o mesmo seletor canônico de produto sem roubo de foco', () => {
  assert.match(v2, /onSelectProduct\(heroProduct\)/);
  assert.match(v2, /aria-label=\{`Ver \$\{heroProduct\.name\}`\}/);
  assert.match(card, /onClick=\{\(\) => onSelectProduct\(product\)\}/);
  assert.match(card, /aria-label=\{`Ver detalhes de \$\{product\.name\}/);
  assert.doesNotMatch(v2, /\.focus\(\)/);
  assert.doesNotMatch(card, /\.focus\(\)/);
});

test('cards de destaques e feed da home delegam diretamente ao MenuProductCard canônico', () => {
  assert.match(v2, /<MenuProductCard/);
  assert.match(v2, /onSelectProduct=\{onSelectProduct/);
  assert.match(card, /id=\{`product-card-\$\{product\.id\}`\}/);
});
