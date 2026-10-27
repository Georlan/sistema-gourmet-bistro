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
  assert.match(source, /Tentar Novamente/);
  assert.match(source, /setLoading\(false\)/);
});

test('confirmação de entrega abandona POST travado sem repetir a mutação', () => {
  assert.match(source, /const CONFIRM_DELIVERY_REQUEST_TIMEOUT_MS = 12_000;/);

  const confirmation = source.slice(
    source.indexOf('const handleConfirmarEntrega'),
    source.indexOf('const blocked ='),
  );

  assert.match(confirmation, /const controller = new AbortController\(\);/);
  assert.match(
    confirmation,
    /window\.setTimeout\(\(\) => controller\.abort\(\), CONFIRM_DELIVERY_REQUEST_TIMEOUT_MS\)/,
  );
  assert.match(confirmation, /signal: controller\.signal/);
  assert.match(confirmation, /err\?\.name === 'AbortError'/);
  assert.match(confirmation, /Atualizando o painel antes de permitir nova tentativa/);
  assert.match(confirmation, /await carregarDadosPainel\(token, true\)/);
  assert.match(confirmation, /window\.clearTimeout\(timeoutId\)/);
  assert.doesNotMatch(confirmation, /await handleConfirmarEntrega\(comandaId\)/);
});

test('suspensão em segundo plano cancela GET pendente sem falso alerta de timeout e retoma no primeiro plano', () => {
  assert.match(source, /const cancelPendingGet = useCallback\(\(markSuspended = false\) =>/);
  assert.match(source, /getRef\.current = null;\s*if \(markSuspended\) suspendedReadRef\.current = true;\s*activeGet\.abort\(\);/);
  assert.match(source, /if \(document\.visibilityState === 'hidden'\)\s*\{\s*suspendedReadRef\.current = true;\s*return false;\s*\}/);
  assert.match(source, /window\.addEventListener\('pageshow', resume\);/);
  assert.match(source, /window\.addEventListener\('pagehide', suspend\);/);
});