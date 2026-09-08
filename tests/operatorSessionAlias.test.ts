import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const authSession = readFileSync('src/utils/authSession.ts', 'utf8');
const caixaService = readFileSync('src/config/caixaService.ts', 'utf8');
const onlineControl = readFileSync('src/components/caixa/online-menu/OnlineOrderEmergencyControl.tsx', 'utf8');

test('runtime auth no longer persists the generic localStorage token alias', () => {
  assert.doesNotMatch(authSession, /localStorage\.setItem\(['"]token['"]/);
  assert.match(authSession, /localStorage\.removeItem\(['"]token['"]\)/);
});

test('operational helpers use the centralized token accessor instead of generic alias fallback', () => {
  for (const source of [caixaService, onlineControl]) {
    assert.match(source, /getOperatorAccessToken/);
    assert.doesNotMatch(source, /localStorage\.getItem\(['"]token['"]\)/);
  }
});
