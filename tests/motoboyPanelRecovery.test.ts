import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(
  new URL('../src/components/MotoboyPwaPage.tsx', import.meta.url),
  'utf8',
);

test('painel do entregador abandona request travada e oferece recuperação', () => {
  assert.match(source, /const PANEL_REQUEST_TIMEOUT_MS = 12_000;/);
  assert.match(source, /const controller = new AbortController\(\);/);
  assert.match(source, /window\.setTimeout\(\(\) => controller\.abort\(\), PANEL_REQUEST_TIMEOUT_MS\)/);
  assert.match(source, /signal: controller\.signal/);
  assert.match(source, /err\?\.name === 'AbortError'/);
  assert.match(source, /demorou demais para responder/);
  assert.match(source, /window\.clearTimeout\(timeoutId\)/);
  assert.match(source, /> Tentar Novamente</);
  assert.match(source, /setLoading\(false\)/);
});
