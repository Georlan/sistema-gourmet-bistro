/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

const DB_NAME = "koma_push_resume_v1";
const DB_VERSION = 1;
const STORE_NAME = "orders";
const RESUME_TTL_MS = 24 * 60 * 60 * 1000;
const KDF_SALT = new TextEncoder().encode("koma-push-resume-v1");

interface PushResumeRecord {
  orderId: string;
  ciphertext: string;
  iv: string;
  createdAt: number;
  expiresAt: number;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  bytes.forEach((value) => { binary += String.fromCharCode(value); });
  return btoa(binary);
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "orderId" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Falha ao abrir armazenamento seguro de notificações."));
  });
}

async function deriveResumeKey(subscription: PushSubscription, orderId: string): Promise<CryptoKey> {
  const auth = subscription.getKey("auth");
  if (!auth) throw new Error("Assinatura de notificação sem chave de retomada.");

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
      salt: KDF_SALT,
      info: new TextEncoder().encode(`order:${orderId}`),
    },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt"],
  );
}

export async function persistPushResumeCapability(
  orderId: string,
  trackingToken: string,
  subscription: PushSubscription,
): Promise<void> {
  const cleanOrderId = String(orderId || "").trim();
  const cleanToken = String(trackingToken || "").trim();
  if (!cleanOrderId || !cleanToken) throw new Error("Pedido sem capability de acompanhamento.");
  if (!("indexedDB" in globalThis) || !globalThis.crypto?.subtle) {
    throw new Error("Este navegador não oferece armazenamento seguro para retomar o pedido.");
  }

  const key = await deriveResumeKey(subscription, cleanOrderId);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(cleanToken);
  const encrypted = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
      additionalData: new TextEncoder().encode(cleanOrderId),
    },
    key,
    plaintext,
  );

  const now = Date.now();
  const record: PushResumeRecord = {
    orderId: cleanOrderId,
    ciphertext: bytesToBase64(new Uint8Array(encrypted)),
    iv: bytesToBase64(iv),
    createdAt: now,
    expiresAt: now + RESUME_TTL_MS,
  };

  const db = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error("Falha ao proteger capability de acompanhamento."));
      tx.onabort = () => reject(tx.error || new Error("Falha ao proteger capability de acompanhamento."));
    });
  } finally {
    db.close();
  }
}

export async function removePushResumeCapability(orderId: string): Promise<void> {
  const cleanOrderId = String(orderId || "").trim();
  if (!cleanOrderId || !("indexedDB" in globalThis)) return;
  const db = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).delete(cleanOrderId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error("Falha ao remover capability de retomada."));
      tx.onabort = () => reject(tx.error || new Error("Falha ao remover capability de retomada."));
    });
  } finally {
    db.close();
  }
}
