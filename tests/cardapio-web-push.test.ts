import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sw = readFileSync("public/koma-sw.js", "utf8");
const manifest = readFileSync("public/manifest.webmanifest", "utf8");
const pushUi = readFileSync("src/cardapio/components/CardapioPushNotifications.tsx", "utf8");
const pushResumeStore = readFileSync("src/cardapio/pushResumeStore.ts", "utf8");
const trackingPage = readFileSync("src/cardapio/OrderTrackingPage.tsx", "utf8");
const ordersDrawer = readFileSync("src/cardapio/components/CardapioOrdersDrawer.tsx", "utf8");
const main = readFileSync("src/main.tsx", "utf8");

test("Web Push só pede permissão depois de ação explícita do cliente", () => {
  assert.match(pushUi, /onClick=\{\(\) => void enable\(\)\}/);
  assert.match(pushUi, /Notification\.requestPermission\(\)/);
  assert.doesNotMatch(main, /Notification\.requestPermission\(\)/);
});

test("service worker não intercepta fetch/cache do cardápio", () => {
  assert.match(sw, /addEventListener\("push"/);
  assert.match(sw, /addEventListener\("notificationclick"/);
  assert.doesNotMatch(sw, /addEventListener\("fetch"/);
  assert.match(sw, /\/cardapio\?restaurante_id=/);
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
  // O comentário explicativo menciona unsubscribe propositalmente — verificamos
  // apenas que não existe chamada executável (await/void/.then) de unsubscribe().
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

  assert.match(ordersDrawer, /requestedPushOrderFromHash/);
  assert.match(ordersDrawer, /KOMA_PUSH_OPEN_ORDER/);
  assert.match(ordersDrawer, /openChat\(order\.id\)/);
  assert.match(ordersDrawer, /setFloatingOpen\(true\)/);
});
