import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(
  new URL('../src/components/app/data/useOperationalTables.ts', import.meta.url),
  'utf8',
);

test('bootstrap de mesas abandona request travado antes do retry operacional', () => {
  assert.match(source, /const TABLES_REQUEST_TIMEOUT_MS = 6_000;/);
  assert.match(source, /globalThis\.setTimeout\(\(\) => \{\s*timedOut = true;\s*controller\.abort\(\);\s*\}, TABLES_REQUEST_TIMEOUT_MS\);/s);
  assert.match(source, /if \(timedOut && requestScopeKey === scopeKeyRef\.current\) \{\s*setFetchError\('A leitura das mesas demorou demais\./s);
  assert.match(source, /globalThis\.clearTimeout\(timeoutId\);/);
});

test('abort por troca de escopo ou supersessão continua silencioso', () => {
  assert.match(source, /if \(err\.name === 'AbortError'\) \{\s*if \(timedOut && requestScopeKey === scopeKeyRef\.current\)/s);
  assert.doesNotMatch(source, /if \(err\.name === 'AbortError'\) \{\s*setFetchError/s);
});
