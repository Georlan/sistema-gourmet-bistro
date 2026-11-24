import { register } from 'node:module';
register('./helpers/staticAssetsLoader.mjs', import.meta.url);
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const page = readFileSync(new URL('../src/cardapio/CardapioPage.tsx', import.meta.url), 'utf8');
const wsBlock = page.slice(page.indexOf('/ws/cliente'), page.indexOf('const orderingEnabled'));

test('cardápio fecha o WebSocket ocioso após 60s com a aba oculta', () => {
  assert.match(wsBlock, /HIDDEN_DISCONNECT_MS = 60_000/);
  assert.match(wsBlock, /hiddenDisconnectTimer = setTimeout/);
  assert.match(wsBlock, /pausedByHidden = true;[\s\S]*ws\?\.close\(\)/);
  assert.match(wsBlock, /if \(stopped \|\| !document\.hidden\) return;/);
});

test('ao voltar visível cancela o timer, recarrega o catálogo e reconecta', () => {
  const visible = wsBlock.slice(wsBlock.indexOf('clearTimeout(hiddenDisconnectTimer);\n        hiddenDisconnectTimer = undefined;\n      }\n      pausedByHidden = false'));
  assert.match(visible, /pausedByHidden = false/);
  assert.match(visible, /loadRestaurantData\(true\)/);
  assert.match(visible, /connect\(\)/);
});

test('suspensão por aba oculta não agenda reconexão automática e o cleanup limpa o timer', () => {
  assert.match(wsBlock, /if \(pausedByHidden \|\| document\.hidden\) return;\s*reconnectTimer = setTimeout\(\(\) => \{\s*reconnectTimer = undefined;\s*connect\(\);/);
  assert.match(wsBlock, /if \(hiddenDisconnectTimer\) clearTimeout\(hiddenDisconnectTimer\);\s*ws\?\.close\(\);/);
});

test('cardápio mantém imports estáticos e toast em CSS puro', () => {
  assert.doesNotMatch(page, /React\.lazy\(/);
  assert.doesNotMatch(page, /motion\/react|KOMA_EASE_SMOOTH/);
});

test('reconexão mantém somente um socket e invalida timers e callbacks antigos', () => {
  assert.match(wsBlock, /if \(ws && ws\.readyState !== WebSocket\.CLOSED\) return;/);
  assert.match(wsBlock, /if \(reconnectTimer\) \{\s*clearTimeout\(reconnectTimer\);\s*reconnectTimer = undefined;\s*\}\s*const socket = new WebSocket/);
  assert.match(wsBlock, /socket\.onopen = \(\) => \{\s*if \(stopped \|\| ws !== socket\) return;/);
  assert.match(wsBlock, /socket\.onmessage = \(event\) => \{\s*if \(stopped \|\| ws !== socket\) return;/);
});
