import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const drawer = source('../src/cardapio/components/CardapioOrdersDrawer.tsx');
const clientPanel = source('../src/cardapio/components/CardapioOrderChatPanel.tsx');
const cashierHook = source('../src/components/caixa/chat/useCashierChat.ts');
const trackingRoute = source('../backend/app/routes/order_tracking.py');

test('cardapio mantém um gatilho flutuante de chat dentro da própria página', () => {
  assert.match(drawer, /floating-order-chat-trigger/);
  assert.match(drawer, /Chat do pedido/);
  assert.match(drawer, /Fale com o restaurante/);
  assert.match(drawer, /setFloatingOpen\(true\)/);
  assert.match(drawer, /onClose=\{closeDrawer\}/);
});

test('cliente recebe badge visual de mensagens não lidas do restaurante', () => {
  assert.match(drawer, /unread_count/);
  assert.match(drawer, /Nova mensagem/);
  assert.match(drawer, /O restaurante respondeu/);
  assert.match(trackingRoute, /OrderMessage\.sender_type == "staff"/);
  assert.match(trackingRoute, /"unread_count": customer_unread_count/);
});

test('conversa aberta continua marcando novas respostas como lidas', () => {
  assert.match(clientPanel, /messages\.length/);
  assert.match(clientPanel, /\/read/);
  assert.match(clientPanel, /visibilitychange/);
});

test('caixa atualiza badge rapidamente e sinaliza não lidas também na aba do navegador', () => {
  assert.match(cashierHook, /\/api\/caixa\/conversas\/unread-count/);
  assert.match(cashierHook, /5000/);
  assert.match(cashierHook, /document\.title/);
  assert.match(cashierHook, /chatUnreadCount/);
});
