import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sw = readFileSync("public/koma-sw.js", "utf8");
const manifest = readFileSync("public/manifest.webmanifest", "utf8");
const indexHtml = readFileSync("index.html", "utf8");
const pushUi = readFileSync("src/cardapio/components/CardapioPushNotifications.tsx", "utf8");
const pushResumeStore = readFileSync("src/cardapio/pushResumeStore.ts", "utf8");
const trackingPage = readFileSync("src/cardapio/OrderTrackingPage.tsx", "utf8");
const ordersDrawer = readFileSync("src/cardapio/components/CardapioOrdersDrawer.tsx", "utf8");
const main = readFileSync("src/main.tsx", "utf8");
const webPushBackend = readFileSync("backend/app/services/web_push.py", "utf8");
const caixaChat = readFileSync("backend/app/routes/caixa_chat.py", "utf8");

test("Web Push só pede permissão depois de ação explícita do cliente", () => {
  assert.match(pushUi, /onClick=\{\(\) => void enable\(\)\}/);
  assert.match(pushUi, /Notification\.requestPermission\(\)/);
  assert.doesNotMatch(main, /Notification\.requestPermission\(\)/);
});

test("falha do serviço de push recebe feedback legível sem expor erro bruto", () => {
  assert.match(pushUi, /push service error/);
  assert.match(pushUi, /Registration failed/i);
  assert.match(pushUi, /O serviço de notificações do navegador não respondeu/);
  assert.match(pushUi, /Seu pedido continua disponível aqui mesmo sem os avisos/);
});

test("HTML declara capability PWA moderna e mantém compatibilidade Apple", () => {
  assert.match(indexHtml, /name="mobile-web-app-capable" content="yes"/);
  assert.match(indexHtml, /name="apple-mobile-web-app-capable" content="yes"/);
});

test("service worker não intercepta fetch/cache do cardápio", () => {
  assert.match(sw, /addEventListener\("push"/);
  assert.match(sw, /addEventListener\("notificationclick"/);
  assert.doesNotMatch(sw, /addEventListener\("fetch"/);
  assert.match(sw, /\/cardapio\?restaurante_id=/);
});

test("service worker usa actions e renotify nas notificações", () => {
  assert.match(sw, /actions,/);
  assert.match(sw, /renotify: payload\.renotify !== false/);
  assert.match(sw, /Abrir conversa/);
  assert.match(sw, /Acompanhar pedido/);
  assert.match(webPushBackend, /'message' if kind == 'message' else 'status'/);
  assert.match(webPushBackend, /f"koma-order-\{order_hash\}-/);
});

test("status do pedido usa tag estável e chat não sobrescreve status", () => {
  assert.match(webPushBackend, /Status e chat nunca se sobrescrevem/i);
  assert.match(webPushBackend, /'message' if kind == 'message' else 'status'/);
  assert.match(webPushBackend, /"renotify": True/);
  assert.match(webPushBackend, /"vibrate": vibration/);
});

test("preview de mensagem é resolvido no dispatcher sem copiar body para outbox", () => {
  assert.match(caixaChat, /message_id=msg\.id/);
  assert.match(webPushBackend, /payload\["message_id"\]/);
  assert.match(webPushBackend, /message_body = message\.body/);
  assert.doesNotMatch(webPushBackend, /payload\["(?:body|message_body)"\]\s*=/);
  assert.doesNotMatch(webPushBackend, /"(?:body|message_body)"\s*:\s*(?:message_body|raw_body)/);
  assert.match(webPushBackend, /sanitize_message_preview/);
});

test("PWA mantém experiência standalone sem substituir o cardápio", () => {
  const parsed = JSON.parse(manifest) as { display?: string; start_url?: string };
  assert.equal(parsed.display, "standalone");
  assert.equal(parsed.start_url, "/cardapio");
});

test("iOS orienta instalação antes de pedir permissão", () => {
  assert.match(pushUi, /Adicionar à Tela de Início/);
  assert.match(pushUi, /isIosDevice\(\) && !isStandalone\(\)/);
});

test("desativar um pedido não cancela a PushSubscription global", () => {
  assert.match(pushUi, /Não chamamos PushSubscription\.unsubscribe/);
  assert.doesNotMatch(pushUi, /(?:await|void|\.then\()[\s\S]{0,40}\.unsubscribe\(\)/);
});

test("capability de retomada fica cifrada e fora de localStorage", () => {
  assert.match(pushResumeStore, /indexedDB\.open\(DB_NAME, DB_VERSION\)/);
  assert.match(pushResumeStore, /name: "HKDF"/);
  assert.match(pushResumeStore, /name: "AES-GCM"/);
  assert.match(pushResumeStore, /crypto\.subtle\.encrypt/);
  assert.doesNotMatch(pushResumeStore, /localStorage|sessionStorage/);
  assert.match(pushUi, /persistPushResumeCapability\(order\.id, token, subscription\)/);
  assert.match(pushUi, /removePushResumeCapability\(order\.id\)/);
});

test("clique da notificação retoma cold-start sem capability em payload ou query string", () => {
  assert.match(sw, /recoverPushResumeToken\(pedidoId\)/);
  assert.match(sw, /crypto\.subtle\.decrypt/);
  assert.match(sw, /\/acompanhar#token=\$\{encodeURIComponent\(resumeToken\)\}/);
  assert.match(sw, /#koma-order=\$\{encodeURIComponent\(pedidoId\)\}/);
  assert.match(sw, /KOMA_PUSH_OPEN_ORDER/);
  assert.doesNotMatch(sw, /\/acompanhar\//);
  assert.doesNotMatch(sw, /tracking[_-]?token/i);

  assert.match(trackingPage, /new URLSearchParams\(window\.location\.hash/);
  assert.match(trackingPage, /window\.history\.replaceState/);
  assert.match(trackingPage, /"\/acompanhar"/);
  assert.match(trackingPage, /api\/cardapio\/pedidos\/acompanhar\/\$\{encodeURIComponent\(token\)\}/);
  assert.match(trackingPage, /setRetryNonce\(\(current\) => current \+ 1\)/);
  assert.doesNotMatch(trackingPage, /window\.location\.reload\(\)/);

  assert.match(ordersDrawer, /requestedPushOrderFromHash/);
  assert.match(ordersDrawer, /KOMA_PUSH_OPEN_ORDER/);
  assert.match(ordersDrawer, /openChat\(order\.id\)/);
  assert.match(ordersDrawer, /setFloatingOpen\(true\)/);
});
