import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync('src/components/cardapio/ComplementosTab.tsx', 'utf8');

test('complementos não expõe aplicação automática de sugestões', () => {
  assert.equal(source.includes('Aplicar sugestões'), false);
  assert.equal(source.includes('/cardapio/modificadores/sugestoes/hamburgueria'), false);
  assert.equal(source.includes('handleApplySuggestions'), false);
});
