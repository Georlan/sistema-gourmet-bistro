import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const drawer = source('../src/cardapio/components/CardapioOrdersDrawer.tsx');
const panel = source('../src/cardapio/components/CardapioOrderChatPanel.tsx');
const header = source('../src/cardapio/components/CardapioHeader.tsx');
const legacyTracking = source('../src/cardapio/OrderTrackingPage.tsx');
const emergencyControl = source('../src/components/caixa/online-menu/OnlineOrderEmergencyControl.tsx');

test('chat do pedido permanece dentro do cardapio em vez de navegar para outra pagina', () => {
  assert.match(drawer, /openChat\(order\.id\)/);
  assert.match(drawer, /setChatOrderId\(orderId\)/);
  assert.match(drawer, /<CardapioOrderChatPanel/);
  assert.doesNotMatch(drawer, /href=\{order\.tracking_url \|\| `\/acompanhar\//);
});

test('painel lateral oferece timeline, historico e envio de mensagem', () => {
  assert.match(panel, /api\/cardapio\/pedidos\/acompanhar/);
  assert.match(panel, /new EventSource/);
  assert.match(panel, /\/messages/);
  assert.match(panel, /Chat e acompanhamento sem sair do cardápio/);
  assert.match(panel, /\["Recebido", "Em preparo", "Pronto", "Saiu", "Concluído"\]/);
});

test('cabecalho deixa o retorno ao pedido e chat explicito', () => {
  assert.match(header, /Pedido \/ Chat/);
  assert.match(header, /Abrir acompanhamento e chat dos pedidos/);
});

test('link legado de acompanhamento restaura o pedido e volta ao cardapio', () => {
  assert.match(legacyTracking, /saveStoredOrder\(/);
  assert.match(legacyTracking, /window\.location\.replace\(`\/cardapio\?restaurante_id=/);
  assert.match(legacyTracking, /acompanhamento e a conversa agora ficam juntos em Pedido \/ Chat/);
  assert.doesNotMatch(legacyTracking, /LINHA DO TEMPO AO VIVO/);
});

test('modal deixa explicito que somente o cardapio online sera pausado', () => {
  assert.match(emergencyControl, /z-\[9999\]/);
  assert.match(emergencyControl, /Pausar apenas o cardápio online\?/);
  assert.match(emergencyControl, /O restaurante continua operando normalmente/);
  assert.match(emergencyControl, /Só novas compras pelo cardápio online serão bloqueadas/);
  assert.match(emergencyControl, /Pausar cardápio online/);
});
