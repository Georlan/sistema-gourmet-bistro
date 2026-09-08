import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sw = readFileSync("public/koma-sw.js", "utf8");
const manifest = readFileSync("public/manifest.webmanifest", "utf8");
const pushUi = readFileSync("src/cardapio/components/CardapioPushNotifications.tsx", "utf8");
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
  assert.doesNotMatch(sw, /tracking_token|acompanhar\//);
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

test("clique da notificação abre diretamente o chat do pedido sem expor tracking token", () => {
  assert.match(sw, /#koma-order=\$\{encodeURIComponent\(pedidoId\)\}/);
  assert.match(sw, /KOMA_PUSH_OPEN_ORDER/);
  assert.match(ordersDrawer, /requestedPushOrderFromHash/);
  assert.match(ordersDrawer, /KOMA_PUSH_OPEN_ORDER/);
  assert.match(ordersDrawer, /openChat\(order\.id\)/);
  assert.match(ordersDrawer, /setFloatingOpen\(true\)/);
  assert.doesNotMatch(sw, /tracking[_-]?token|acompanhar\//i);
});
