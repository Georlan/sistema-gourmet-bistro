import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const trackingSource = readFileSync('src/cardapio/orderTracking.ts', 'utf8');
const drawerSource = readFileSync('src/cardapio/components/CardapioOrdersDrawer.tsx', 'utf8');
const chatSource = readFileSync('src/cardapio/components/CardapioOrderChatPanel.tsx', 'utf8');
const pageSource = readFileSync('src/cardapio/CardapioPage.tsx', 'utf8');

test('cardápio usa contrato canônico e não recria parsers por substring', () => {
  assert.equal(drawerSource.includes('function deliveryOrderStep'), false);
  assert.equal(chatSource.includes('function journeyStep'), false);
  assert.equal(trackingSource.includes('normalized.includes("final")'), false);
  assert.equal(trackingSource.includes('normalized.includes("entreg")'), false);
  assert.equal(trackingSource.includes('normalized.includes("prepar")'), false);

  assert.match(drawerSource, /resolveOrderState\(order\)/);
  assert.match(chatSource, /state\.progress_step/);
  assert.match(pageSource, /resolveOrderState\(activeOrder\)/);
  assert.match(pageSource, /activeState\.label/);
});

test('fallback de compatibilidade é mapa exato, não substring', () => {
  assert.match(trackingSource, /const STATUS_ALIASES:/);
  assert.match(trackingSource, /STATUS_ALIASES\[rawStatus\]/);
});
