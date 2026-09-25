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
const trackingRoute = source('../backend/app/routes/order_tracking.py');
const cashierChatRoute = source('../backend/app/routes/caixa_chat.py');
const archiveService = source('../backend/app/services/order_chat_archive_service.py');
const cardapioRoute = source('../backend/app/routes/cardapio.py');
const cardapioPage = source('../src/cardapio/CardapioPage.tsx');

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

test('conversa aberta marca leitura só quando existe resposta observada da equipe', () => {
  assert.match(clientPanel, /observedStaffUnreadRef/);
  assert.match(clientPanel, /incoming\.sender_type === "staff"/);
  assert.match(clientPanel, /readInFlightRef/);
  assert.match(clientPanel, /\/read/);
  assert.match(clientPanel, /visibilitychange/);
  assert.doesNotMatch(clientPanel, /\[markRead, messages\.length\]/);
});


test('cardapio usa SSE e resumo leve em vez de polling contínuo de pedidos', () => {
  assert.match(drawer, /new EventSource/);
  assert.match(drawer, /\/summary/);
  assert.match(drawer, /30000/);
  assert.doesNotMatch(drawer, /6000/);
  assert.match(clientPanel, /\$\{apiRoot\}\/summary/);
  assert.match(clientPanel, /isReconnect[\s\S]*void refresh\(\)/);
  assert.match(drawer, /openedOrders/);
  assert.doesNotMatch(cardapioPage, /ACTIVE_ORDER_REFRESH_MS/);
  assert.doesNotMatch(cardapioPage, /setInterval\(refresh/);
  assert.match(cardapioPage, /onRealtimeStatus=\{handleRealtimeOrderStatus\}/);
});

test('mudança de fulfillment acorda o Cardápio sem fingir novo status', () => {
  assert.match(clientPanel, /addEventListener\("refresh"/);
  assert.match(drawer, /addEventListener\("refresh"/);
  assert.match(cardapioPage, /onRealtimeRefresh=\{handleRealtimeOrderRefresh\}/);
  assert.match(cardapioPage, /checkActiveOrders\(Number\(activeBrand\.id\)\)/);
});

test('resumo público de tracking evita carregar itens e restaurante no hot path', () => {
  assert.match(trackingRoute, /@router\.get\("\/\{token\}\/summary"/);
  assert.match(trackingRoute, /func\.count\(OrderMessage\.id\)/);
  assert.match(trackingRoute, /customer_unread_count/);
});

test('realtime do acompanhamento sincroniza a modalidade convertida do pedido', () => {
  assert.match(drawer, /tipo\?: string;/);
  assert.match(drawer, /state\?: OrderStateContract;/);
  assert.match(drawer, /payload\.tipo/);
  assert.match(drawer, /payload\.state/);
  assert.match(cardapioPage, /backendState\?: OrderStateContract/);
  assert.match(cardapioPage, /const nextTipo = String\(tipo \|\| order\.tipo/);
  assert.match(cardapioPage, /currentState\).*JSON\.stringify\(state\)/);
  assert.match(cardapioPage, /tipo: nextTipo/);
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

test('Caixa evita POST de leitura quando a conversa já está zerada', () => {
  assert.match(cashierDrawer, /unreadByConversationRef/);
  assert.match(cashierDrawer, /if \(!force && \(unreadByConversationRef\.current\.get\(conversationId\) \|\| 0\) <= 0\) return/);
  assert.match(cashierDrawer, /force: true/);
});

test('read_update do Caixa não recarrega a thread nem dispara nova marcação de leitura', () => {
  assert.match(cashierDrawer, /case 'read_update':/);
  const readUpdateBlock = cashierDrawer.split("case 'read_update':")[1]?.split('default:')[0] ?? '';
  assert.doesNotMatch(readUpdateBlock, /loadMessages/);
  assert.doesNotMatch(readUpdateBlock, /markConversationRead/);
  assert.match(cashierDrawer, /background:\s*true,\s*markRead:\s*false/);
  assert.match(cashierDrawer, /case 'new_message':/);
  assert.match(cashierDrawer, /items\.some\(\(item\) => item\.id === message\.id\)/);
});

test('central do Caixa prioriza atenção sem permitir resposta rápida fingir status', () => {
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

test('central do Caixa fecha por backdrop e Escape sem apagar o realtime corrigido', () => {
  assert.match(cashierDrawer, /event\.target === event\.currentTarget/);
  assert.match(cashierDrawer, /event\.key === 'Escape'/);
  assert.match(cashierDrawer, /case 'reconnected':/);
  assert.match(cashierDrawer, /case 'new_message':/);
  assert.match(cashierDrawer, /case 'status_changed':/);
  assert.match(cashierDrawer, /case 'read_update':/);
  assert.match(cashierHook, /event: 'reconnected'/);
});

test('central do Caixa consulta somente conversas operacionais ativas', () => {
  assert.match(cashierChatRoute, /list_caixa_conversations/);
  assert.doesNotMatch(cashierChatRoute, /list_caixa_conversations_for_central/);
  assert.match(cashierDrawer, /Somente pedidos ativos/);
  assert.doesNotMatch(cashierDrawer, /filterButton\('archived'/);
  assert.doesNotMatch(cashierDrawer, /filterButton\('all'/);
});

test('pedido terminal permanece read-only e não reabre pós-venda', () => {
  assert.doesNotMatch(trackingRoute, /reopen_completed_conversation_if_needed/);
  assert.doesNotMatch(trackingRoute, /state_contract\["can_chat"\] = True/);
  assert.doesNotMatch(clientPanel, /atendimento de pós-venda/);
  assert.doesNotMatch(archiveService, /conversation\.closed_at = None/);
});


test('rascunhos ficam locais e envios carregam chave idempotente', () => {
  assert.match(clientPanel, /sessionStorage\.setItem\(draftKey, input\)/);
  assert.match(clientPanel, /client_message_id: clientMessageId/);
  assert.match(cashierDrawer, /CASHIER_CHAT_DRAFT_TTL_MS/);
  assert.match(cashierDrawer, /localStorage\.setItem/);
  assert.match(cashierDrawer, /client_message_id: clientMessageId/);
});
