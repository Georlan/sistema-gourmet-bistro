import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const drawer = readFileSync(
  new URL('../src/components/caixa/chat/CashierConversationsDrawer.tsx', import.meta.url),
  'utf8',
);
const mobileCss = readFileSync(
  new URL('../src/components/caixa/navigation/cashierLowHeight.css', import.meta.url),
  'utf8',
);

test('cashier chat exposes stable hooks for a full-screen mobile workspace', () => {
  assert.match(drawer, /id="cashier-chat-overlay"/);
  assert.match(drawer, /id="cashier-chat-panel"/);
  assert.match(drawer, /aria-label="Respostas rápidas"/);
  assert.match(drawer, /scroll-smooth/);
});

test('mobile cashier chat owns the viewport and keeps scroll inside the drawer', () => {
  assert.match(mobileCss, /#cashier-chat-overlay\s*\{[\s\S]*?z-index:\s*100\s*!important/);
  assert.match(mobileCss, /#cashier-chat-overlay\s*\{[\s\S]*?height:\s*100dvh/);
  assert.match(mobileCss, /body:has\(#cashier-chat-overlay\)[\s\S]*?overflow:\s*hidden\s*!important/);
  assert.match(mobileCss, /#cashier-chat-panel\s*\{[\s\S]*?overflow:\s*hidden/);
  assert.match(mobileCss, /#cashier-chat-panel \.scroll-smooth\s*\{[\s\S]*?min-height:\s*0/);
  assert.match(mobileCss, /#cashier-chat-panel \.scroll-smooth\s*\{[\s\S]*?touch-action:\s*pan-y/);
  assert.match(mobileCss, /\[aria-label="Respostas rápidas"\][\s\S]*?scrollbar-width:\s*none/);
  assert.match(mobileCss, /textarea\[placeholder="Responder ao cliente\.\.\."\][\s\S]*?resize:\s*none/);
});
