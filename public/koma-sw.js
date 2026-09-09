/* KÔMA Web Push service worker.
 * Sem fetch/cache handler por intenção: não interfere no deploy do Vite nem em
 * dados dinâmicos do cardápio. A responsabilidade aqui é somente push + clique.
 */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: "KÔMA", body: "Seu pedido tem uma atualização." };
  }

  const title = String(payload.title || "KÔMA");
  const body = String(payload.body || "Seu pedido tem uma atualização.");
  const tag = String(payload.tag || "koma-order-update");
  const data = payload.data && typeof payload.data === "object" ? payload.data : {};

  event.waitUntil(self.registration.showNotification(title, {
    body,
    tag,
    renotify: true,
    icon: "/logo-koma.png",
    badge: "/logo-koma.png",
    data,
    actions: [{ action: "open", title: "Ver pedido" }],
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const restaurantId = Number(data.restaurantId || 0);
  const pedidoId = String(data.pedidoId || "");
  if (!restaurantId || !pedidoId) return;

  const target = `/cardapio?restaurante_id=${encodeURIComponent(String(restaurantId))}#koma-order=${encodeURIComponent(pedidoId)}`;

  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const existing = windows.find((client) => {
      try {
        return new URL(client.url).origin === self.location.origin;
      } catch {
        return false;
      }
    });

    if (existing) {
      // Navegar é intencional: garante que um cliente que estava em outra tela
      // volte ao Cardápio. O hash carrega somente o id do pedido, nunca o
      // tracking token/capability URL.
      if ("navigate" in existing) await existing.navigate(target);
      await existing.focus();
      existing.postMessage({
        type: "KOMA_PUSH_OPEN_ORDER",
        restaurantId,
        pedidoId,
      });
      return;
    }

    await self.clients.openWindow(target);
  })());
});
