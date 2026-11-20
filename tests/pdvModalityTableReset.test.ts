import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const pdvHook = readFileSync(new URL('../src/components/caixa/pdv/useCashierPdv.ts', import.meta.url), 'utf8');

test('PDV clears stale table selection when switching away from dine_in and after confirmed sale', () => {
  assert.match(pdvHook, /if\s*\(nextType\s*!==\s*'dine_in'\)\s*setPdvTargetMesaId\(0\);/);
  assert.match(pdvHook, /setChangeFor\(''\);\s*\n\s*setPdvTargetMesaId\(0\);/);
  assert.doesNotMatch(pdvHook, /Retirada · Mesa/);
});
