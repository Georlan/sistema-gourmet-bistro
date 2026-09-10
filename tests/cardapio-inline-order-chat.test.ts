import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const drawer = source('../src/cardapio/components/CardapioOrdersDrawer.tsx');
const panel = source('../src/cardapio/components/CardapioOrderChatPanel.tsx');
const header = source('../src/cardapio/components/CardapioHeader.tsx');
const customIcons = source('../src/cardapio/components/KomaPublicIcons.tsx');
const chatPolish = source('../src/cardapio/cardapioChatPolish.css');
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

test('cabecalho publico usa a familia de icones originais do KOMA sem trocar a semantica da sacola', () => {
  assert.match(header, /KomaSearchIcon/);
  assert.match(header, /KomaLocationIcon/);
  assert.match(header, /KomaInfoIcon/);
  assert.match(header, /KomaShareIcon/);
  assert.match(header, /KomaOrderChatIcon/);
  assert.match(header, /KomaBagIcon/);
  assert.match(header, /KomaUserIcon/);
  assert.match(header, /KomaSocialCameraIcon/);
  assert.doesNotMatch(header, /\b(?:Info|Instagram|MapPin|MessageCircle|Search|Share2|ShoppingBag|UserRound)\b[\s\S]*from "lucide-react"/);
  assert.match(customIcons, /stroke="currentColor"/);
  assert.match(customIcons, /var\(--color-brand-primary\)/);
});

test('painel e drawer compartilham a linguagem KOMA e preservam mobile sem overflow', () => {
  assert.match(panel, /KomaOrderChatIcon/);
  assert.doesNotMatch(panel, /\bMessageCircle\b[\s\S]*from "lucide-react"/);
  assert.match(panel, /cardapioChatPolish\.css/);
  assert.match(chatPolish, /#floating-order-chat-trigger/);
  assert.match(chatPolish, /max-width:\s*min\(22rem,\s*calc\(100vw - 2rem\)\)/);
  assert.match(chatPolish, /@media \(max-width: 480px\)/);
  assert.match(chatPolish, /#orders-drawer-panel[\s\S]*width:\s*100vw/);
  assert.match(chatPolish, /prefers-reduced-motion/);
});

test('link legado de acompanhamento restaura o pedido e volta ao cardapio', () => {
  assert.match(legacyTracking, /saveStoredOrder\(/);
  assert.match(legacyTracking, /window\.location\.replace\(/);
  assert.match(
    legacyTracking,
    /\/cardapio\?restaurante_id=\$\{encodeURIComponent\(String\(restauranteId\)\)\}/,
  );
  assert.match(legacyTracking, /#koma-order=\$\{encodeURIComponent\(pedidoId\)\}/);
  assert.match(legacyTracking, /aria-busy="true"/);
  assert.doesNotMatch(legacyTracking, /LINHA DO TEMPO AO VIVO/);
});

test('modal deixa explicito que somente o cardapio online sera pausado', () => {
  assert.match(emergencyControl, /createPortal\(/);
  assert.match(emergencyControl, /document\.body/);
  assert.match(emergencyControl, /z-\[9999\]/);
  assert.match(emergencyControl, /Pausar apenas o cardápio online\?/);
  assert.match(emergencyControl, /O restaurante continua operando normalmente/);
  assert.match(emergencyControl, /Só novas compras pelo cardápio online serão bloqueadas/);
  assert.match(emergencyControl, /Pausar cardápio online/);
});
