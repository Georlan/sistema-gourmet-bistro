import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

const conditions = source('../src/cardapio/components/CardapioOrderConditions.tsx');
const highlights = source('../src/cardapio/components/CardapioHighlights.tsx');
const recommendations = source('../src/cardapio/components/CardapioRecommendations.tsx');

test('Mais escolhidos abre o mesmo acionador canônico do card do produto', () => {
  assert.match(conditions, /querySelector<HTMLButtonElement>\('\.cardapio-product-card__details-hitbox'\)/);
  assert.match(conditions, /detailsTrigger\.click\(\)/);
  assert.match(conditions, /onClick=\{\(\) => openProduct\(product\)\}/);
  assert.match(conditions, /aria-label=\{`Abrir \$\{product\.name\}`\}/);
});

test('Destaques e Complete seu pedido usam a mesma abertura direta', () => {
  for (const component of [highlights, recommendations]) {
    assert.match(component, /detailsTrigger\.click\(\)/);
    assert.match(component, /onClick=\{\(\) => openProduct\(product\)\}/);
    assert.doesNotMatch(component, /\.focus\(\)/);
  }
});

test('há fallback de navegação somente quando o card canônico não está no DOM', () => {
  for (const component of [conditions, highlights, recommendations]) {
    assert.match(component, /target\?\.scrollIntoView/);
  }
});
