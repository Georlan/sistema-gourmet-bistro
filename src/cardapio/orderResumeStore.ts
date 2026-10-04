/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Retomada durável de pedidos anônimos.
 *
 * O tracking_token é uma capability sensível: ele nunca é gravado em texto
 * puro no localStorage. Para sobreviver ao fechamento da aba, mantemos um
 * snapshot mínimo cifrado no IndexedDB com uma chave AES-GCM não exportável
 * gerada no próprio navegador. Falhas de IndexedDB/Web Crypto degradam para o
 * comportamento anterior (sessionStorage) sem bloquear checkout ou chat.
 */

const DB_NAME = "koma_order_resume_v1";
const DB_VERSION = 1;
const ORDER_STORE = "orders";
const KEY_STORE = "keys";
const KEY_ID = "resume-aes-gcm-v1";
const RESUME_TTL_MS = 24 * 60 * 60 * 1000;

export interface DurableOrderResume {
  id: string;
  numero_pedido: string | number;
  timestamp: number;
  restaurante_id: number;
  tipo: string;
  total: number;
  idempotency_key: string;
  status?: string;
  state?: unknown;
  fechado?: boolean;
  created_at?: string;
  tracking_token: string;
}

interface EncryptedOrderResumeRecord {
  orderId: string;
  restaurantId: number;
  ciphertext: string;
  iv: string;
  createdAt: number;
  expiresAt: number;
}

interface StoredCryptoKey {
  id: string;
  key: CryptoKey;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  bytes.forEach((value) => { binary += String.fromCharCode(value); });
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function storageAvailable(): boolean {
  return (
    typeof indexedDB !== "undefined"
    && typeof crypto !== "undefined"
    && Boolean(crypto.subtle)
  );
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(ORDER_STORE)) {
        const orders = db.createObjectStore(ORDER_STORE, { keyPath: "orderId" });
        orders.createIndex("restaurantId", "restaurantId", { unique: false });
      }
      if (!db.objectStoreNames.contains(KEY_STORE)) {
        db.createObjectStore(KEY_STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Falha ao abrir armazenamento de retomada."));
  });
}

async function getOrCreateKey(db: IDBDatabase): Promise<CryptoKey> {
  const existing = await new Promise<StoredCryptoKey | undefined>((resolve, reject) => {
    const tx = db.transaction(KEY_STORE, "readonly");
    const request = tx.objectStore(KEY_STORE).get(KEY_ID);
    request.onsuccess = () => resolve(request.result as StoredCryptoKey | undefined);
    request.onerror = () => reject(request.error || new Error("Falha ao ler chave de retomada."));
  });
  if (existing?.key) return existing.key;

  const key = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(KEY_STORE, "readwrite");
    tx.objectStore(KEY_STORE).put({ id: KEY_ID, key } satisfies StoredCryptoKey);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error("Falha ao salvar chave de retomada."));
    tx.onabort = () => reject(tx.error || new Error("Falha ao salvar chave de retomada."));
  });

  return key;
}

function sanitizeResume(order: DurableOrderResume): DurableOrderResume | null {
  const orderId = String(order?.id || "").trim();
  const trackingToken = String(order?.tracking_token || "").trim();
  const restaurantId = Number(order?.restaurante_id);
  const timestamp = Number(order?.timestamp || 0);
  const now = Date.now();

  if (
    !orderId
    || !trackingToken
    || !Number.isFinite(restaurantId)
    || !Number.isFinite(timestamp)
    || now - timestamp > RESUME_TTL_MS
  ) {
    return null;
  }

  return {
    id: orderId,
    numero_pedido: order.numero_pedido ?? orderId,
    timestamp,
    restaurante_id: restaurantId,
    tipo: String(order.tipo || "Retirada"),
    total: Number(order.total || 0),
    idempotency_key: "",
    status: order.status ? String(order.status) : undefined,
    state: order.state,
    fechado: Boolean(order.fechado),
    created_at: order.created_at ? String(order.created_at) : undefined,
    tracking_token: trackingToken,
  };
}

function associatedData(record: Pick<EncryptedOrderResumeRecord, "restaurantId" | "orderId">): Uint8Array {
  return new TextEncoder().encode(`${record.restaurantId}:${record.orderId}`);
}

async function deleteRecord(db: IDBDatabase, orderId: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(ORDER_STORE, "readwrite");
    tx.objectStore(ORDER_STORE).delete(orderId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error("Falha ao remover retomada de pedido."));
    tx.onabort = () => reject(tx.error || new Error("Falha ao remover retomada de pedido."));
  });
}

export async function persistOrderResume(order: DurableOrderResume): Promise<void> {
  if (!storageAvailable()) return;
  const snapshot = sanitizeResume(order);
  if (!snapshot) return;

  const db = await openDatabase();
  try {
    const key = await getOrCreateKey(db);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv,
        additionalData: associatedData({
          restaurantId: snapshot.restaurante_id,
          orderId: snapshot.id,
        }),
      },
      key,
      new TextEncoder().encode(JSON.stringify(snapshot)),
    );

    const record: EncryptedOrderResumeRecord = {
      orderId: snapshot.id,
      restaurantId: snapshot.restaurante_id,
      ciphertext: bytesToBase64(new Uint8Array(encrypted)),
      iv: bytesToBase64(iv),
      createdAt: Date.now(),
      expiresAt: snapshot.timestamp + RESUME_TTL_MS,
    };

    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(ORDER_STORE, "readwrite");
      tx.objectStore(ORDER_STORE).put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error("Falha ao salvar retomada de pedido."));
      tx.onabort = () => reject(tx.error || new Error("Falha ao salvar retomada de pedido."));
    });
  } finally {
    db.close();
  }
}

export async function loadOrderResumes(restaurantId: number): Promise<DurableOrderResume[]> {
  if (!storageAvailable() || !Number.isFinite(restaurantId)) return [];

  const db = await openDatabase();
  try {
    const key = await getOrCreateKey(db);
    const records = await new Promise<EncryptedOrderResumeRecord[]>((resolve, reject) => {
      const tx = db.transaction(ORDER_STORE, "readonly");
      const index = tx.objectStore(ORDER_STORE).index("restaurantId");
      const request = index.getAll(restaurantId);
      request.onsuccess = () => resolve((request.result || []) as EncryptedOrderResumeRecord[]);
      request.onerror = () => reject(request.error || new Error("Falha ao carregar retomadas de pedido."));
    });

    const now = Date.now();
    const restored: DurableOrderResume[] = [];
    for (const record of records) {
      if (record.expiresAt <= now) {
        await deleteRecord(db, record.orderId);
        continue;
      }

      try {
        const decrypted = await crypto.subtle.decrypt(
          {
            name: "AES-GCM",
            iv: base64ToBytes(record.iv),
            additionalData: associatedData(record),
          },
          key,
          base64ToBytes(record.ciphertext),
        );
        const parsed = JSON.parse(new TextDecoder().decode(decrypted)) as DurableOrderResume;
        const snapshot = sanitizeResume(parsed);
        if (snapshot && snapshot.restaurante_id === restaurantId) {
          restored.push(snapshot);
        } else {
          await deleteRecord(db, record.orderId);
        }
      } catch {
        await deleteRecord(db, record.orderId);
      }
    }

    return restored.sort((a, b) => b.timestamp - a.timestamp).slice(0, 20);
  } finally {
    db.close();
  }
}

export async function removeOrderResume(orderId: string): Promise<void> {
  const cleanOrderId = String(orderId || "").trim();
  if (!cleanOrderId || !storageAvailable()) return;
  const db = await openDatabase();
  try {
    await deleteRecord(db, cleanOrderId);
  } finally {
    db.close();
  }
}

export async function clearOrderResumes(restaurantId?: number): Promise<void> {
  if (!storageAvailable()) return;
  const db = await openDatabase();
  try {
    if (typeof restaurantId !== "number" || !Number.isFinite(restaurantId)) {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(ORDER_STORE, "readwrite");
        tx.objectStore(ORDER_STORE).clear();
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error || new Error("Falha ao limpar retomadas de pedido."));
        tx.onabort = () => reject(tx.error || new Error("Falha ao limpar retomadas de pedido."));
      });
      return;
    }

    const records = await new Promise<EncryptedOrderResumeRecord[]>((resolve, reject) => {
      const tx = db.transaction(ORDER_STORE, "readonly");
      const index = tx.objectStore(ORDER_STORE).index("restaurantId");
      const request = index.getAll(restaurantId);
      request.onsuccess = () => resolve((request.result || []) as EncryptedOrderResumeRecord[]);
      request.onerror = () => reject(request.error || new Error("Falha ao listar retomadas de pedido."));
    });
    for (const record of records) {
      await deleteRecord(db, record.orderId);
    }
  } finally {
    db.close();
  }
}
