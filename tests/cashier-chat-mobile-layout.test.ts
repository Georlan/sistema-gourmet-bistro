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
  assert.match(drawer, /aria-label="Lista de conversas"/);
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

test('mobile chat polish keeps filters visible and touch targets intentional', () => {
  assert.match(drawer, /overflow-hidden'[,]?\s*selectedId/);
  assert.match(drawer, /min-h-0 flex-1 overflow-y-auto overscroll-contain touch-pan-y/);
  assert.match(drawer, /aria-label="Voltar para conversas"[\s\S]*?<ArrowLeft size=\{18\}/);
  assert.match(drawer, /className="sm:hidden flex size-11/);
  assert.match(drawer, /className="hidden sm:inline">Enter envia/);
  assert.match(drawer, /bg-gradient-to-l from-zinc-900 via-zinc-900\/80 to-transparent sm:hidden/);
});

test('conversation statuses are presented with operational labels instead of raw backend states', () => {
  assert.match(drawer, /getCashierDeliveryStatusLabel/);
  assert.match(drawer, /conversationStatusLabel/);
  assert.match(drawer, /return 'Concluído'/);
  assert.match(drawer, /return 'Recusado'/);
  assert.match(drawer, /return 'Cancelado'/);
  assert.match(drawer, /\{conversationStatusLabel\(conversation\)\}/);
  assert.match(drawer, /\{conversationStatusLabel\(selectedConv\)\}/);
});
