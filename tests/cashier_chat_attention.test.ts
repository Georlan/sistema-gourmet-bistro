import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const chatHook = readFileSync('src/components/caixa/chat/useCashierChat.ts', 'utf8');
const attentionCss = readFileSync('src/components/caixa/chat/cashierChatAttention.css', 'utf8');
const orderAlerts = readFileSync('src/components/caixa/realtime/useCashierAlerts.ts', 'utf8');

test('mensagem de cliente usa assinatura sonora própria e respeita som desativado', () => {
  assert.match(chatHook, /data\?\.sender_type !== 'customer'/);
  assert.match(chatHook, /@koma:sound_enabled/);
  assert.match(chatHook, /587\.33/);
  assert.match(chatHook, /739\.99/);
  assert.match(chatHook, /soundedMessageIdsRef/);

  // O som de novo pedido permanece com assinatura diferente.
  assert.match(orderAlerts, /783\.99/);
  assert.doesNotMatch(chatHook, /783\.99/);
});

test('botão Conversas ganha atenção forte apenas quando há não lidas', () => {
  assert.match(attentionCss, /#btn-caixa-conversas-drawer\[aria-label\*="mensagens não lidas"\]/);
  assert.match(attentionCss, /koma-chat-attention/);
  assert.match(attentionCss, /koma-chat-attention-ring/);
  assert.match(attentionCss, /span\[role="status"\]/);
  assert.match(attentionCss, /#fbbf24/);
});

test('rótulos repetitivos de aguardando resposta deixam de competir visualmente', () => {
  assert.match(attentionCss, /#cashier-chat-panel \.text-amber-300/);
  assert.match(attentionCss, /#cashier-chat-panel \.sticky\.top-0\.z-10/);
  assert.match(attentionCss, /display: none !important/);
});

test('animação respeita preferência por movimento reduzido', () => {
  assert.match(attentionCss, /prefers-reduced-motion: reduce/);
  assert.match(attentionCss, /animation: none !important/);
});
