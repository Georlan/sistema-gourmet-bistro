import { normalizeStaffRole, resolveOperationalPortal, type OperationalPortal } from './staffDestination';
export type { OperationalPortal } from './staffDestination';

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface OperatorIdentitySnapshot {
  id?: string | number;
  nome?: string;
  role?: string;
  cargo?: string;
  restaurante_id?: number;
}

export interface OperatorSession {
  token: string;
  user: OperatorIdentitySnapshot;
  expiresAt: number; // Timestamp de expiração em milissegundos
}

export const OPERATOR_SESSION_CHANGED = 'koma-operator-session-changed';

function notifySessionChanged(): void {
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') window.dispatchEvent(new Event(OPERATOR_SESSION_CHANGED));
}

const LEGACY_SESSION_KEY = 'koma_operator_session';
const SESSION_KEY_BY_PORTAL: Record<OperationalPortal, string> = {
  caixa: 'koma_operator_session_caixa',
  garcom: 'koma_operator_session_garcom',
};
const ACTIVE_PORTAL_KEY = 'koma_active_operational_portal';
const LOGGED_OUT_TAB_KEY = 'koma_operational_logged_out';
const FALLBACK_SESSION_MS = 30 * 24 * 60 * 60 * 1000;
const CAIXA_ALIAS_KEYS = [
  'koma_caixa_token',
  'koma_caixa_id',
  'koma_caixa_name',
  'koma_caixa_user_id',
  'koma_caixa_user_name',
  'koma_caixa_role',
] as const;
const WAITER_ALIAS_KEYS = [
  'koma_waiter_token',
  'koma_waiter_id',
  'koma_waiter_name',
  'koma_user_role',
] as const;


function minimalOperatorIdentity(user: any): OperatorIdentitySnapshot {
  const snapshot: OperatorIdentitySnapshot = {};
  if (user?.id != null) snapshot.id = user.id;
  if (user?.nome) snapshot.nome = String(user.nome);
  if (user?.role) snapshot.role = String(user.role);
  if (user?.cargo) snapshot.cargo = String(user.cargo);
  if (Number.isInteger(user?.restaurante_id) && user.restaurante_id > 0) snapshot.restaurante_id = user.restaurante_id;
  return snapshot;
}

function getTabStorage(): Storage | null {
  try { return typeof sessionStorage === 'undefined' ? null : sessionStorage; }
  catch { return null; }
}

function clearKeys(storage: Storage | null, keys: readonly string[]): void {
  for (const key of keys) {
    try { if (storage?.getItem(key) !== null) storage?.removeItem(key); } catch { /* Storage may be blocked. */ }
  }
}

function getTabPortal(): OperationalPortal | null {
  let value: string | null = null;
  try { value = getTabStorage()?.getItem(ACTIVE_PORTAL_KEY) ?? null; } catch { return null; }
  return value === 'caixa' || value === 'garcom' ? value : null;
}

function discardSharedAuthentication(): void {
  // O token compartilhado pode ter sido substituído por outra aba. Não é
  // possível atribuí-lo com segurança à aba antiga: exigir novo login.
  try {
    if (typeof localStorage === 'undefined') return;
    clearKeys(localStorage, ['token', LEGACY_SESSION_KEY, ...Object.values(SESSION_KEY_BY_PORTAL),
      'koma_last_operational_portal', ...CAIXA_ALIAS_KEYS, ...WAITER_ALIAS_KEYS]);
  } catch { /* Shared storage is never a source of authentication. */ }
}

function readJwtExpiryMs(token: string): number | null {
  try {
    const payloadPart = token.split('.')[1];
    if (!payloadPart || typeof atob !== 'function') return null;
    const normalized = payloadPart.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    const expSeconds = Number(JSON.parse(atob(padded))?.exp);
    return Number.isFinite(expSeconds) && expSeconds > 0 ? expSeconds * 1000 : null;
  } catch { return null; }
}

function persistScopedAliases(portal: OperationalPortal, session: OperatorSession): void {
  const storage = getTabStorage();
  const keys = portal === 'garcom' ? WAITER_ALIAS_KEYS : CAIXA_ALIAS_KEYS;
  clearKeys(storage, keys);
  const prefix = portal === 'garcom' ? 'koma_waiter' : 'koma_caixa';
  storage?.setItem(`${prefix}_token`, session.token);
  if (session.user.id != null) storage?.setItem(`${prefix}_id`, String(session.user.id));
  if (session.user.nome) storage?.setItem(`${prefix}_name`, session.user.nome);
  storage?.setItem(portal === 'garcom' ? 'koma_user_role' : 'koma_caixa_role',
    String(session.user.role || session.user.cargo || portal));
}

export function getOperatorSession(portal?: OperationalPortal): OperatorSession | null {
  discardSharedAuthentication();
  const storage = getTabStorage();
  const selectedPortal = portal || getTabPortal();
  if (!storage || !selectedPortal) return null;
  try {
    if (storage.getItem(LOGGED_OUT_TAB_KEY)) return null;
    const raw = storage.getItem(SESSION_KEY_BY_PORTAL[selectedPortal]);
    let parsed: OperatorSession;
    if (raw) {
      parsed = JSON.parse(raw);
      const aliasKey = selectedPortal === 'garcom' ? 'koma_waiter_token' : 'koma_caixa_token';
      if (storage.getItem(aliasKey) !== parsed.token) throw new Error('Session replaced');
    }
    else {
      // Compatibilidade somente com os aliases locais da própria aba.
      const prefix = selectedPortal === 'garcom' ? 'koma_waiter' : 'koma_caixa';
      const token = storage.getItem(`${prefix}_token`) || '';
      if (!token) return null;
      parsed = { token, user: {
        id: storage.getItem(`${prefix}_id`) || undefined,
        nome: storage.getItem(`${prefix}_name`) || undefined,
        role: storage.getItem(selectedPortal === 'garcom' ? 'koma_user_role' : 'koma_caixa_role') || selectedPortal,
      }, expiresAt: readJwtExpiryMs(token) ?? Date.now() + FALLBACK_SESSION_MS };
    }
    const expiresAt = readJwtExpiryMs(parsed.token) ?? Number(parsed.expiresAt);
    if (!parsed.token || !Number.isFinite(expiresAt) || Date.now() >= expiresAt) throw new Error('Invalid session');
    const user = minimalOperatorIdentity(parsed.user);
    // Sem identidade recuperável o App não consegue carregar seu escopo.
    // A presença do token na aba, sozinha, não restaura uma sessão operacional.
    if (!user.id || !user.nome?.trim() || !resolveOperationalPortal(user)) throw new Error('Incomplete session identity');
    const role = normalizeStaffRole(user);
    if (resolveOperationalPortal(user) !== selectedPortal && !(selectedPortal === 'garcom' && role === 'admin')) throw new Error('Session portal mismatch');
    const session = { token: parsed.token, user, expiresAt };
    if (!raw) storage.setItem(SESSION_KEY_BY_PORTAL[selectedPortal], JSON.stringify(session));
    return session;
  } catch {
    clearOperatorSession(selectedPortal, false);
    return null;
  }
}

export function saveOperatorSession(token: string, user: any, requestedPortal?: OperationalPortal): void {
  discardSharedAuthentication();
  const storage = getTabStorage();
  const minimalUser = minimalOperatorIdentity(user);
  const defaultPortal = resolveOperationalPortal(minimalUser);
  const portal = requestedPortal === 'garcom' && normalizeStaffRole(minimalUser) === 'admin'
    ? 'garcom' : defaultPortal;
  if (!storage) throw new Error('Não foi possível guardar a sessão nesta aba. Permita o armazenamento do site e tente novamente.');
  if (!portal) throw new Error('Este perfil não possui acesso operacional.');
  const previous = getOperatorSession();
  if (previous && (previous.user.id !== minimalUser.id || previous.user.restaurante_id !== minimalUser.restaurante_id)) {
    clearKeys(storage, ['koma_settings_vFinal_v3', 'koma_restaurant_name_v3',
      'koma_caixa_selected_table_v3', 'koma_garcom_selected_table_v3', 'koma_onboarding_setup_mode']);
  }
  // Uma identidade operacional por aba; nenhuma escrita em sessão de outra aba.
  clearKeys(storage, [...Object.values(SESSION_KEY_BY_PORTAL), ...CAIXA_ALIAS_KEYS, ...WAITER_ALIAS_KEYS]);
  const session = { token, user: minimalUser, expiresAt: readJwtExpiryMs(token) ?? Date.now() + FALLBACK_SESSION_MS };
  try {
    storage.setItem(SESSION_KEY_BY_PORTAL[portal], JSON.stringify(session));
    persistScopedAliases(portal, session);
    storage.setItem(ACTIVE_PORTAL_KEY, portal);
    storage.removeItem(LOGGED_OUT_TAB_KEY);
  } catch {
    clearOperatorSession(undefined, false);
    throw new Error('Não foi possível guardar a sessão nesta aba. Permita o armazenamento do site e tente novamente.');
  }
  notifySessionChanged();
}

export function getPersistedOperationalPortal(): OperationalPortal | null {
  discardSharedAuthentication();
  const tabPortal = getTabPortal();
  if (tabPortal) {
    return getOperatorSession(tabPortal) ? tabPortal : null;
  }
  return null;
}

export function getOperationalAccessToken(portal: OperationalPortal): string {
  return getOperatorSession(portal)?.token || '';
}

export function getOperatorAccessToken(): string {
  const portal = getTabPortal();
  return portal ? getOperationalAccessToken(portal) : '';
}

export function clearOperatorSession(portal?: OperationalPortal, notify = true): void {
  discardSharedAuthentication();
  const storage = getTabStorage();
  const selectedPortal = portal || getTabPortal();
  clearKeys(storage, selectedPortal
    ? [SESSION_KEY_BY_PORTAL[selectedPortal], ...(selectedPortal === 'garcom' ? WAITER_ALIAS_KEYS : CAIXA_ALIAS_KEYS)]
    : [...Object.values(SESSION_KEY_BY_PORTAL), ...CAIXA_ALIAS_KEYS, ...WAITER_ALIAS_KEYS]);
  clearKeys(storage, ['koma_settings_vFinal_v3', 'koma_restaurant_name_v3',
    'koma_caixa_selected_table_v3', 'koma_garcom_selected_table_v3', 'koma_onboarding_setup_mode']);
  clearKeys(storage, [ACTIVE_PORTAL_KEY]);
  try { storage?.setItem(LOGGED_OUT_TAB_KEY, '1'); } catch { /* No persistence available. */ }
  if (notify) notifySessionChanged();
}

/** Notifications stay in this window: signing out must not sign out other tabs. */
export function subscribeOperatorSession(listener: () => void): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const scheduleExpiry = () => {
    clearTimeout(timer);
    const session = getOperatorSession();
    if (session) timer = setTimeout(check, Math.min(Math.max(1, session.expiresAt - Date.now() + 1), 2_147_483_647));
  };
  const check = () => { listener(); scheduleExpiry(); };
  const visibility = () => { if (document.visibilityState === 'visible') check(); };
  window.addEventListener(OPERATOR_SESSION_CHANGED, check);
  window.addEventListener('focus', check);
  window.addEventListener('pageshow', check);
  document.addEventListener('visibilitychange', visibility);
  scheduleExpiry();
  return () => {
    clearTimeout(timer);
    window.removeEventListener(OPERATOR_SESSION_CHANGED, check);
    window.removeEventListener('focus', check);
    window.removeEventListener('pageshow', check);
    document.removeEventListener('visibilitychange', visibility);
  };
}
