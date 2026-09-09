/* KÔMA Web Push service worker.
 * Sem fetch/cache handler por intenção: não interfere no deploy do Vite nem em
 * dados dinâmicos do cardápio. A responsabilidade aqui é somente push + clique.
 */
const PUSH_RESUME_DB = "koma_push_resume_v1";
const PUSH_RESUME_DB_VERSION = 1;
const PUSH_RESUME_STORE = "orders";
const PUSH_RESUME_KDF_SALT = new TextEncoder().encode("koma-push-resume-v1");

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

function base64ToBytes(value) {
  const raw = atob(String(value || ""));
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
}

function openPushResumeDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(PUSH_RESUME_DB, PUSH_RESUME_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(PUSH_RESUME_STORE)) {
        db.createObjectStore(PUSH_RESUME_STORE, { keyPath: "orderId" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("push resume db unavailable"));
  });
}

async function readPushResumeRecord(orderId) {
  const db = await openPushResumeDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(PUSH_RESUME_STORE, "readonly");
      const request = tx.objectStore(PUSH_RESUME_STORE).get(orderId);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error || new Error("push resume read failed"));
    });
  } finally {
    db.close();
  }
}

async function deletePushResumeRecord(orderId) {
  const db = await openPushResumeDb();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(PUSH_RESUME_STORE, "readwrite");
      tx.objectStore(PUSH_RESUME_STORE).delete(orderId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error("push resume delete failed"));
      tx.onabort = () => reject(tx.error || new Error("push resume delete failed"));
    });
  } finally {
    db.close();
  }
}

async function derivePushResumeKey(subscription, orderId) {
  const auth = subscription.getKey("auth");
  if (!auth) return null;
  const baseKey = await crypto.subtle.importKey(
    "raw",
    auth,
    "HKDF",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: PUSH_RESUME_KDF_SALT,
      info: new TextEncoder().encode(`order:${orderId}`),
    },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"],
  );
}

async function recoverPushResumeToken(orderId) {
  try {
    if (!self.crypto?.subtle || !("indexedDB" in self)) return "";
    const record = await readPushResumeRecord(orderId);
    if (!record) return "";
    if (Number(record.expiresAt || 0) <= Date.now()) {
      await deletePushResumeRecord(orderId).catch(() => undefined);
      return "";
    }

    const subscription = await self.registration.pushManager.getSubscription();
    if (!subscription) return "";
    const key = await derivePushResumeKey(subscription, orderId);
    if (!key) return "";

    const plaintext = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: base64ToBytes(record.iv),
        additionalData: new TextEncoder().encode(orderId),
      },
      key,
      base64ToBytes(record.ciphertext),
    );
    return new TextDecoder().decode(plaintext).trim();
  } catch {
    // Capability ausente/corrompida nunca bloqueia o clique: usamos fallback
    // sem segredo e deixamos o cardápio abrir normalmente.
    return "";
  }
}

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

  event.waitUntil((async () => {
    const resumeToken = await recoverPushResumeToken(pedidoId);
    // A capability nunca entra no payload do Push nem em query string. Quando
    // existe retomada segura, ela vai somente no fragmento local do navegador;
    // a rota /acompanhar limpa o fragmento antes de consultar a API.
    const target = resumeToken
      ? `/acompanhar#token=${encodeURIComponent(resumeToken)}`
      : `/cardapio?restaurante_id=${encodeURIComponent(String(restaurantId))}#koma-order=${encodeURIComponent(pedidoId)}`;

    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const existing = windows.find((client) => {
      try {
        return new URL(client.url).origin === self.location.origin;
      } catch {
        return false;
      }
    });

    if (existing) {
      if ("navigate" in existing) await existing.navigate(target);
      await existing.focus();
      if (!resumeToken) {
        existing.postMessage({
          type: "KOMA_PUSH_OPEN_ORDER",
          restaurantId,
          pedidoId,
        });
      }
      return;
    }

    await self.clients.openWindow(target);
  })());
});
