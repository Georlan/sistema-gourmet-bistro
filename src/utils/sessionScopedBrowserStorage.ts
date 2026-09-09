/**
 * Session-scoped compatibility boundary for legacy operational storage keys.
 * Durable values are migrated once during bootstrap and then removed.
 */

const OPERATIONAL_SESSION_KEYS = new Set([
  'koma_operator_session',
  'koma_caixa_token',
  'koma_caixa_id',
  'koma_caixa_name',
  'koma_caixa_user_id',
  'koma_caixa_user_name',
  'koma_caixa_role',
  'koma_waiter_token',
  'koma_waiter_id',
  'koma_waiter_name',
  'koma_user_role',
  'koma_token',
  'koma_user_id',
  'koma_user_name',
  'token',
]);

const BOUNDARY_FLAG = '__komaOperationalSessionStorageScoped';
let installed = false;

function isOperationalSessionKey(key: string): boolean {
  return OPERATIONAL_SESSION_KEYS.has(String(key));
}

export function isSessionScopedBrowserStorageInstalled(): boolean {
  return typeof window !== 'undefined'
    && (window as unknown as Record<string, unknown>)[BOUNDARY_FLAG] === true;
}

export function installSessionScopedBrowserStorage(): void {
  if (installed || typeof window === 'undefined' || typeof Storage === 'undefined') return;
  installed = true;

  const durable = window.localStorage;
  const scoped = window.sessionStorage;
  const originalGetItem = Storage.prototype.getItem;
  const originalSetItem = Storage.prototype.setItem;
  const originalRemoveItem = Storage.prototype.removeItem;

  const migrateAtBootstrap = (key: string) => {
    const durableValue = originalGetItem.call(durable, key);
    if (durableValue != null) {
      originalSetItem.call(scoped, key, durableValue);
      originalRemoveItem.call(durable, key);
    }
  };

  OPERATIONAL_SESSION_KEYS.forEach(migrateAtBootstrap);
  (window as unknown as Record<string, unknown>)[BOUNDARY_FLAG] = true;

  Storage.prototype.getItem = function getItem(key: string): string | null {
    if (isOperationalSessionKey(key)) {
      return originalGetItem.call(scoped, key);
    }
    return originalGetItem.call(this, key);
  };

  Storage.prototype.setItem = function setItem(key: string, value: string): void {
    if (isOperationalSessionKey(key)) {
      originalSetItem.call(scoped, key, String(value));
      originalRemoveItem.call(durable, key);
      return;
    }
    originalSetItem.call(this, key, value);
  };

  Storage.prototype.removeItem = function removeItem(key: string): void {
    if (isOperationalSessionKey(key)) {
      originalRemoveItem.call(scoped, key);
      originalRemoveItem.call(durable, key);
      return;
    }
    originalRemoveItem.call(this, key);
  };
}

installSessionScopedBrowserStorage();
