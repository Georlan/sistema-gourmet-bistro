import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const drawer = source('../src/cardapio/components/CardapioOrdersDrawer.tsx');
const clientPanel = source('../src/cardapio/components/CardapioOrderChatPanel.tsx');
const legacyTrackingPage = source('../src/cardapio/OrderTrackingPage.tsx');
const cashierDrawer = source('../src/components/caixa/chat/CashierConversationsDrawer.tsx');
const cashierHook = source('../src/components/caixa/chat/useCashierChat.ts');
const cashierRealtime = source('../src/components/caixa/chat/cashierChatRealtime.ts');
const orderRealtime = source('../src/cardapio/orderChatRealtime.ts');
const trackingRoute = source('../backend/app/routes/order_tracking.py');
const chatService = source('../backend/app/services/order_chat_service.py');
const cashierChatRoute = source('../backend/app/routes/caixa_chat.py');
const archiveService = source('../backend/app/services/order_chat_archive_service.py');
const cardapioRoute = source('../backend/app/routes/cardapio.py');

test('cardapio mantém um gatilho flutuante de chat dentro da própria página', () => {
  assert.match(drawer, /floating-order-chat-trigger/);
  assert.match(drawer, /Chat do pedido/);
  assert.match(drawer, /Fale com o restaurante/);
  assert.match(drawer, /setFloatingOpen\(true\)/);
  assert.match(drawer, /onClose=\{closeDrawer\}/);
});

test('gatilho flutuante continua visível e clicável mesmo sem pedido ou login', () => {
  assert.match(drawer, /Pedidos & chat/);
  assert.match(drawer, /Acompanhe seus pedidos/);
  assert.match(drawer, /Abrir pedidos e chat/);
  assert.doesNotMatch(drawer, /if \(!activeOrderForFab\) return null/);
  assert.match(drawer, /Nenhum pedido por aqui ainda/);
  assert.match(drawer, /Este atalho continua disponível mesmo sem login/);
});

test('novos pedidos deixam de emitir tracking_url legado para o cliente', () => {
  assert.match(cardapioRoute, /response\.pop\("tracking_url", None\)/);
  assert.doesNotMatch(cardapioRoute, /response\["tracking_url"\]\s*=\s*None/);
  assert.match(cardapioRoute, /tracking_url é legado/);
});

test('link legado é recuperado silenciosamente e abre o pedido/chat exato no cardápio', () => {
  assert.doesNotMatch(legacyTrackingPage, /Abrindo seu pedido no cardápio/);
  assert.doesNotMatch(legacyTrackingPage, /animate-spin/);
  assert.doesNotMatch(legacyTrackingPage, /tracking_url:\s*`\/acompanhar/);
  assert.match(legacyTrackingPage, /#koma-order=\$\{encodeURIComponent\(pedidoId\)\}/);
  assert.match(legacyTrackingPage, /aria-busy="true"/);
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

test('caixa usa realtime autenticado e polling somente como fallback', () => {
  assert.match(cashierHook, /\/api\/caixa\/conversas\/unread-count/);
  assert.match(cashierHook, /\/api\/caixa\/conversas\/events/);
  assert.match(cashierHook, /30000/);
  assert.match(cashierHook, /chatUnreadStatus/);
  assert.match(cashierHook, /document\.title/);
  assert.match(cashierRealtime, /Accept: 'text\/event-stream'/);
  assert.match(cashierRealtime, /Authorization: authorization/);
});

test('falha de unread não é convertida silenciosamente em zero autoritativo', () => {
  assert.doesNotMatch(cashierHook, /r\.ok\s*\?\s*r\.json\(\)\s*:\s*\{\s*total_unread:\s*0/);
  assert.match(cashierHook, /UNKNOWN nunca vira ZERO/);
  assert.match(cashierHook, /setChatUnreadStatus\('degraded'\)/);
});

test('drawer do Caixa protege seleção contra respostas HTTP atrasadas e não injeta HTML', () => {
  assert.match(cashierDrawer, /AbortController/);
  assert.match(cashierDrawer, /messageGenerationRef/);
  assert.match(cashierDrawer, /selectedIdRef\.current !== conversationId/);
  assert.doesNotMatch(cashierDrawer, /dangerouslySetInnerHTML/);
  assert.match(cashierDrawer, /\{message\.body\}/);
});

test('drawer do Caixa consome o stream compartilhado e reconcilia hints no banco', () => {
  assert.match(cashierDrawer, /subscribeRealtime/);
  assert.doesNotMatch(cashierDrawer, /consumeCashierChatEvents/);
  assert.match(cashierDrawer, /event === 'new_message'/);
  assert.match(cashierDrawer, /loadMessages\(eventConversationId, \{ background: true/);
  assert.match(cashierDrawer, /event === 'status_changed'/);
  assert.match(cashierDrawer, /event === 'read_update'/);
  assert.match(cashierDrawer, /realtimeStatus !== 'degraded'/);
  assert.match(cashierDrawer, /15000/);
});

test('central do Caixa prioriza atenção, oferece respostas rápidas e composer multilinha', () => {
  assert.match(cashierDrawer, /sortedConversations/);
  assert.match(cashierDrawer, /isWaitingForStaff/);
  assert.match(cashierDrawer, /aguardando resposta/);
  assert.match(cashierDrawer, /QUICK_REPLIES/);
  assert.match(cashierDrawer, /Certo, vamos verificar\./);
  assert.doesNotMatch(cashierDrawer, /Seu pedido saiu para entrega\./);
  assert.match(cashierDrawer, /textarea/);
  assert.match(cashierDrawer, /Enter envia · Shift\+Enter quebra linha/);
  assert.match(cashierDrawer, /aria-modal="true"/);
});

test('central do Caixa fecha por backdrop e Escape sem criar um segundo SSE', () => {
  assert.match(cashierDrawer, /event\.target === event\.currentTarget/);
  assert.match(cashierDrawer, /event\.key === 'Escape'/);
  assert.match(cashierDrawer, /subscribeRealtime/);
  assert.doesNotMatch(cashierDrawer, /new EventSource/);
});

test('central do Caixa arquiva pedidos terminais sem apagar histórico', () => {
  assert.match(cashierDrawer, /type ConversationFilter = 'active' \| 'archived' \| 'all'/);
  assert.match(cashierDrawer, /isArchivedConversation/);
  assert.match(cashierDrawer, /TERMINAL_CHAT_STATUSES/);
  assert.match(cashierDrawer, /'finalizado'/);
  assert.match(cashierDrawer, /Ativas/);
  assert.match(cashierDrawer, /Arquivadas/);
  assert.match(cashierDrawer, /Todas/);
  assert.match(cashierDrawer, /type="search"/);
  assert.match(cashierDrawer, /Buscar pedido, cliente ou mensagem/);
  assert.match(cashierDrawer, /Conversa encerrada com o pedido/);
  assert.match(cashierChatRoute, /list_caixa_conversations_for_central/);
  assert.match(archiveService, /OrderConversation\.closed_at\.isnot\(None\)/);
  assert.match(archiveService, /"closed_at": conversation\.closed_at\.isoformat/);
});

test('pedido terminal encerra a conversa e não reabre pós-venda', () => {
  assert.match(cashierDrawer, /isArchivedConversation/);
  assert.doesNotMatch(cashierDrawer, /Pós-venda/);
  assert.doesNotMatch(cashierDrawer, /volta automaticamente para Ativas como pós-venda/);
  assert.doesNotMatch(trackingRoute, /reopen_completed_conversation_if_needed/);
  assert.doesNotMatch(trackingRoute, /state_contract\["can_chat"\] = True/);
  assert.doesNotMatch(archiveService, /conversation\.closed_at = None/);
  assert.doesNotMatch(clientPanel, /atendimento de pós-venda/);
  assert.match(clientPanel, /O atendimento deste pedido foi encerrado/);
});


test('status do pedido não é persistido como mensagem e realtime é pós-commit', () => {
  assert.doesNotMatch(chatService, /CANONICAL_STATUS_MESSAGES/);
  assert.doesNotMatch(chatService, /event_key = f"status:/);
  assert.match(chatService, /enqueue_order_chat_event/);
  assert.match(chatService, /client_message_id/);
  assert.match(orderRealtime, /const connections = new Map/);
  assert.match(orderRealtime, /new EventSource/);
});

test('rascunhos ficam locais e mensagens humanas usam idempotência', () => {
  assert.match(cashierDrawer, /CHAT_DRAFT_TTL_MS = 24 \* 60 \* 60 \* 1000/);
  assert.match(cashierDrawer, /client_message_id: clientMessageId/);
  assert.match(clientPanel, /CUSTOMER_CHAT_DRAFT_TTL_MS = 24 \* 60 \* 60 \* 1000/);
  assert.match(clientPanel, /sessionStorage/);
  assert.match(clientPanel, /client_message_id: clientMessageId/);
});
