import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const smartPosOrdering = readFileSync(
  new URL('../src/smartpos/SmartPosOrderingFlow.tsx', import.meta.url),
  'utf8',
);

test('fallback do catálogo SmartPOS pausa em aba oculta e reconcilia ao voltar', () => {
  assert.match(smartPosOrdering, /const fallbackTick = \(\) => \{/);
  assert.match(smartPosOrdering, /document\.visibilityState === 'visible'\) void loadCatalog\(true\)/);
  assert.match(smartPosOrdering, /window\.setInterval\(fallbackTick, 40000\)/);
  assert.match(smartPosOrdering, /document\.addEventListener\('visibilitychange', handleVisibilityChange\)/);
  assert.match(smartPosOrdering, /document\.removeEventListener\('visibilitychange', handleVisibilityChange\)/);
});

test('uma atualização do catálogo continua buscando catálogo e observações em paralelo', () => {
  assert.match(smartPosOrdering, /Promise\.all\(\[/);
  assert.match(smartPosOrdering, /\/produtos\/catalogo/);
  assert.match(smartPosOrdering, /\/produtos\/observacoes/);
});
