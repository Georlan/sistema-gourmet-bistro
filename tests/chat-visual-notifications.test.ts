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

test('read_update do Caixa não recarrega a thread nem dispara nova marcação de leitura', () => {
  assert.match(cashierDrawer, /case 'read_update':/);
  const readUpdateBlock = cashierDrawer.split("case 'read_update':")[1]?.split('default:')[0] ?? '';
  assert.doesNotMatch(readUpdateBlock, /loadMessages/);
  assert.doesNotMatch(readUpdateBlock, /markConversationRead/);
  assert.match(cashierDrawer, /background:\s*true,\s*markRead:\s*false/);
  assert.match(cashierDrawer, /case 'new_message':/);
  assert.match(cashierDrawer, /items\.some\(\(item\) => item\.id === message\.id\)/);
});

test('central do Caixa prioriza atenção, oferece respostas rápidas e composer multilinha', () => {
  assert.match(cashierDrawer, /sortedConversations/);
  assert.match(cashierDrawer, /isWaitingForStaff/);
  assert.match(cashierDrawer, /aguardando resposta/);
  assert.match(cashierDrawer, /QUICK_REPLIES/);
  assert.match(cashierDrawer, /Estamos preparando seu pedido\./);
  assert.match(cashierDrawer, /textarea/);
  assert.match(cashierDrawer, /Enter envia · Shift\+Enter quebra linha/);
  assert.match(cashierDrawer, /aria-modal="true"/);
});

test('central do Caixa fecha por backdrop e Escape sem apagar o realtime corrigido', () => {
  assert.match(cashierDrawer, /event\.target === event\.currentTarget/);
  assert.match(cashierDrawer, /event\.key === 'Escape'/);
  assert.match(cashierDrawer, /case 'new_message':/);
  assert.match(cashierDrawer, /case 'status_changed':/);
  assert.match(cashierDrawer, /case 'read_update':/);
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
  assert.match(cashierDrawer, /Conversa arquivada/);
  assert.match(cashierChatRoute, /list_caixa_conversations_for_central/);
  assert.match(archiveService, /OrderConversation\.closed_at\.isnot\(None\)/);
  assert.match(archiveService, /"closed_at": conversation\.closed_at\.isoformat/);
});

test('mensagem nova em pedido terminal volta para a fila como pós-venda', () => {
  assert.match(cashierDrawer, /conversation\.unread_count <= 0/);
  assert.match(cashierDrawer, /!isWaitingForStaff\(conversation\)/);
  assert.match(cashierDrawer, /Pós-venda/);
  assert.match(cashierDrawer, /volta automaticamente para Ativas como pós-venda/);
  assert.match(trackingRoute, /reopen_completed_conversation_if_needed/);
  assert.match(trackingRoute, /state_contract\["can_chat"\] = True/);
  assert.match(archiveService, /conversation\.closed_at = None/);
  assert.match(archiveService, /"status": "post_sale"/);
  assert.match(clientPanel, /atendimento de pós-venda sem reabrir o pedido/);
  assert.doesNotMatch(clientPanel, /Boolean\(closedAt\)/);
});
