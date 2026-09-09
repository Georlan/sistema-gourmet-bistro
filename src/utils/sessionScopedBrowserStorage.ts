/**
 * Defense-in-depth para aliases operacionais legados.
 *
 * Parte do shell ainda chama `localStorage` diretamente. Para impedir que bearer
 * tokens e identidade operacional sobrevivam ao fechamento da aba enquanto a
 * migração estrutural termina, esses nomes são redirecionados para sessionStorage
 * no boundary do navegador. Valores duráveis de versões antigas são migrados uma
 * única vez e removidos do disco.
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

let installed = false;

function isOperationalSessionKey(key: string): boolean {
  return OPERATIONAL_SESSION_KEYS.has(String(key));
}

export function installSessionScopedBrowserStorage(): void {
  if (installed || typeof window === 'undefined' || typeof Storage === 'undefined') return;
  installed = true;

  const durable = window.localStorage;
  const scoped = window.sessionStorage;
  const originalGetItem = Storage.prototype.getItem;
  const originalSetItem = Storage.prototype.setItem;
  const originalRemoveItem = Storage.prototype.removeItem;

  const migrate = (key: string) => {
    const scopedValue = originalGetItem.call(scoped, key);
    const durableValue = originalGetItem.call(durable, key);
    if (scopedValue == null && durableValue != null) {
      originalSetItem.call(scoped, key, durableValue);
    }
    if (durableValue != null) {
      originalRemoveItem.call(durable, key);
    }
  };

  OPERATIONAL_SESSION_KEYS.forEach(migrate);

  Storage.prototype.getItem = function getItem(key: string): string | null {
    if (this === durable && isOperationalSessionKey(key)) {
      migrate(key);
      return originalGetItem.call(scoped, key);
    }
    return originalGetItem.call(this, key);
  };

  Storage.prototype.setItem = function setItem(key: string, value: string): void {
    if (this === durable && isOperationalSessionKey(key)) {
      originalSetItem.call(scoped, key, String(value));
      originalRemoveItem.call(durable, key);
      return;
    }
    originalSetItem.call(this, key, value);
  };

  Storage.prototype.removeItem = function removeItem(key: string): void {
    if (this === durable && isOperationalSessionKey(key)) {
      originalRemoveItem.call(scoped, key);
      originalRemoveItem.call(durable, key);
      return;
    }
    originalRemoveItem.call(this, key);
  };
}

installSessionScopedBrowserStorage();
