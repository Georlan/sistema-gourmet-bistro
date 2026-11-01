import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const chatHook = readFileSync('src/components/caixa/chat/useCashierChat.ts', 'utf8');
const attentionCss = readFileSync('src/components/caixa/chat/cashierChatAttention.css', 'utf8');
const orderAlerts = readFileSync('src/components/caixa/realtime/useCashierAlerts.ts', 'utf8');

test('mensagem de cliente usa assinatura sonora própria e respeita som desativado', () => {
  assert.match(chatHook, /data\?\.sender_type !== 'customer'/);
  assert.match(chatHook, /@koma:sound_enabled/);
  assert.match(chatHook, /freq: 440\.0, start: 0,/);
  assert.match(chatHook, /freq: 440\.0, start: 0\.18,/);
  assert.match(chatHook, /osc\.type = 'triangle'/);
  assert.match(chatHook, /soundedMessageIdsRef/);

  assert.match(orderAlerts, /783\.99/);
  assert.match(orderAlerts, /880\.0/);
  assert.match(orderAlerts, /1174\.66/);
  assert.doesNotMatch(chatHook, /783\.99/);
  assert.doesNotMatch(chatHook, /1174\.66/);
});

test('unread conversations keep a visible counter without repeating animations or yellow', () => {
  assert.match(attentionCss, /#btn-caixa-conversas-drawer\[aria-label\*="mensagens não lidas"\]/);
  assert.match(attentionCss, /span\[role="status"\]/);
  assert.doesNotMatch(attentionCss, /animation:|#fbbf24|display: none/);
});
