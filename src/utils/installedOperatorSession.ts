import type { OperatorSession } from './authSession';

/**
 * Retomada do login exclusivamente no PWA operacional instalado.
 * Não altera a política de sessões isoladas das abas normais do navegador.
 * A senha nunca é armazenada; o JWT conserva seu prazo e revogação do backend.
 */
const DB_NAME = 'koma-installed-operator-v1';
const STORE = 'credentials';
const KEY = 'device-key';
const SESSION = 'session';
const SIGNED_OUT_KEY = 'koma-installed-operator-signed-out-v1';
let pendingWrite: Promise<void> = Promise.resolve();

export function isInstalledOperationalApp(): boolean {
  if (typeof window === 'undefined' || !window.location?.hostname) return false;
  const hostname = window.location.hostname.toLowerCase();
  if (hostname !== 'app.komafood.com.br' && hostname !== 'localhost' && hostname !== '127.0.0.1') return false;
  try {
    return window.matchMedia('(display-mode: standalone)').matches
      || (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
  } catch {
    return false;
  }
}

function canUseSecureStorage(): boolean {
  return isInstalledOperationalApp()
    && typeof indexedDB !== 'undefined'
    && typeof crypto !== 'undefined'
    && Boolean(crypto.subtle);
}

function validatedJwtExpiry(session: OperatorSession): number | null {
  try {
    const encoded = session.token.split('.')[1];
    if (!encoded || typeof atob !== 'function') return null;
    const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')));
    const expiry = Number(payload?.exp);
    // O snapshot local não pode escolher um restaurante diferente do JWT.
    if (payload?.restaurante_id !== session.user.restaurante_id
      || String(payload?.sub || '') !== String(session.user.id || '')) return null;
    return Number.isFinite(expiry) && expiry > 0 ? expiry * 1000 : null;
  } catch {
    return null;
  }
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Installed session storage unavailable'));
    request.onblocked = () => reject(new Error('Installed session storage blocked'));
  });
}

function getRecord<T>(db: IDBDatabase, key: string): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
    request.onsuccess = () => resolve(request.result as T | undefined);
    request.onerror = () => reject(request.error || new Error('Installed session read failed'));
  });
}

function commitRecords(db: IDBDatabase, key: CryptoKey | undefined, record?: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, 'readwrite');
    const store = transaction.objectStore(STORE);
    if (key) store.put(key, KEY);
    if (record === undefined) store.delete(SESSION);
    else store.put(record, SESSION);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error('Installed session write failed'));
    transaction.onabort = () => reject(transaction.error || new Error('Installed session write aborted'));
  });
}

function enqueueWrite(action: () => Promise<void>): Promise<void> {
  const result = pendingWrite.then(action);
  pendingWrite = result.catch(() => undefined);
  return pendingWrite;
}

export function rememberInstalledOperatorSession(session: OperatorSession): Promise<void> {
  if (!canUseSecureStorage()) return Promise.resolve();
  try {
    if (sessionStorage.getItem('koma_support_session') || String(session.user.id).startsWith('support:')) {
      return Promise.resolve();
    }
  } catch {
    return Promise.resolve();
  }
  const expiresAt = validatedJwtExpiry(session);
  if (!expiresAt || expiresAt <= Date.now() || !Number.isInteger(session.user.restaurante_id) || !session.user.id) {
    return Promise.resolve();
  }

  return enqueueWrite(async () => {
    const db = await openDatabase();
    try {
      let key = await getRecord<CryptoKey>(db, KEY);
      const newKey = !key;
      if (!key) key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const plaintext = new TextEncoder().encode(JSON.stringify({
        token: session.token, user: session.user, expiresAt,
      }));
      const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);
      await commitRecords(db, newKey ? key : undefined, { iv: Array.from(iv), ciphertext });
      // A flag não é credencial; evita retorno após logout e só limpa depois
      // que a nova credencial cifrada estiver duravelmente persistida.
      try { localStorage.removeItem(SIGNED_OUT_KEY); } catch { /* Storage optional. */ }
    } finally {
      db.close();
    }
  });
}

export function forgetInstalledOperatorSession(): Promise<void> {
  if (!canUseSecureStorage()) return Promise.resolve();
  // A gravação síncrona impede restauração caso a navegação/reload interrompa
  // o delete assíncrono do IndexedDB. Nenhuma senha/token vai para localStorage.
  try { localStorage.setItem(SIGNED_OUT_KEY, '1'); } catch { /* Storage optional. */ }
  return enqueueWrite(async () => {
    const db = await openDatabase();
    try {
      await commitRecords(db, undefined);
    } finally {
      db.close();
    }
  });
}

export async function loadInstalledOperatorSession(): Promise<OperatorSession | null> {
  if (!canUseSecureStorage()) return null;
  try {
    // Logout explícito na mesma janela nunca pode ser revertido pelo recovery.
    if (sessionStorage.getItem('koma_operational_logged_out') || sessionStorage.getItem('koma_support_session')) return null;
    if (localStorage.getItem(SIGNED_OUT_KEY) === '1') return null;
  } catch {
    return null;
  }

  await pendingWrite;
  let db: IDBDatabase | null = null;
  try {
    db = await openDatabase();
    const key = await getRecord<CryptoKey>(db, KEY);
    const record = await getRecord<{ iv: number[]; ciphertext: ArrayBuffer }>(db, SESSION);
    if (!record) return null;
    if (!key || !Array.isArray(record.iv) || record.iv.length !== 12 || !record.ciphertext) {
      await commitRecords(db, undefined);
      return null;
    }
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: Uint8Array.from(record.iv) }, key, record.ciphertext,
    );
    const value = JSON.parse(new TextDecoder().decode(plaintext)) as OperatorSession;
    const expiresAt = typeof value?.token === 'string' && value?.user ? validatedJwtExpiry(value) : null;
    if (!expiresAt || Date.now() >= expiresAt || !value.user || !value.user.id
      || !Number.isInteger(value.user.restaurante_id) || Number(value.user.restaurante_id) <= 0
      || String(value.user.id).startsWith('support:')) {
      await commitRecords(db, undefined);
      return null;
    }
    return { token: value.token, user: value.user, expiresAt };
  } catch {
    // IndexedDB indisponível ou credencial inválida: falha fechada, pede login.
    if (db) await commitRecords(db, undefined).catch(() => undefined);
    return null;
  } finally {
    db?.close();
  }
}

export async function waitForInstalledOperatorSessionWrite(): Promise<void> {
  await pendingWrite;
}
