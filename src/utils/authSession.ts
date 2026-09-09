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
  expiresAt: number;
}

export type OperationalPortal = 'caixa' | 'garcom';

const SESSION_KEY = 'koma_operator_session';
const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

const CAIXA_KEYS = [
  'koma_caixa_token',
  'koma_caixa_id',
  'koma_caixa_name',
  'koma_caixa_user_id',
  'koma_caixa_user_name',
  'koma_caixa_role',
] as const;

const WAITER_KEYS = [
  'koma_waiter_token',
  'koma_waiter_id',
  'koma_waiter_name',
  'koma_user_role',
] as const;

function scopedStorage(): Storage | null {
  return typeof sessionStorage !== 'undefined' ? sessionStorage : null;
}

function durableStorage(): Storage | null {
  return typeof localStorage !== 'undefined' ? localStorage : null;
}

function minimalOperatorIdentity(user: any): OperatorIdentitySnapshot {
  const snapshot: OperatorIdentitySnapshot = {};
  if (user?.id != null) snapshot.id = user.id;
  if (user?.nome) snapshot.nome = String(user.nome);
  if (user?.role) snapshot.role = String(user.role);
  if (user?.cargo) snapshot.cargo = String(user.cargo);
  if (Number.isInteger(user?.restaurante_id) && user.restaurante_id > 0) {
    snapshot.restaurante_id = Number(user.restaurante_id);
  }
  return snapshot;
}

function removeEverywhere(key: string): void {
  try { scopedStorage()?.removeItem(key); } catch { /* best effort */ }
  try { durableStorage()?.removeItem(key); } catch { /* best effort */ }
}

function writeScoped(key: string, value: string): void {
  scopedStorage()?.setItem(key, value);
  try { durableStorage()?.removeItem(key); } catch { /* best effort */ }
}

function readScopedWithLegacyMigration(key: string): string | null {
  const scoped = scopedStorage();
  const durable = durableStorage();
  const current = scoped?.getItem(key) || null;
  if (current != null) {
    try { durable?.removeItem(key); } catch { /* best effort */ }
    return current;
  }

  const legacy = durable?.getItem(key) || null;
  if (legacy == null) return null;
  try {
    scoped?.setItem(key, legacy);
    durable?.removeItem(key);
  } catch {
    // Se sessionStorage estiver indisponível, não prolonga a cópia durável.
    try { durable?.removeItem(key); } catch { /* best effort */ }
    return null;
  }
  return legacy;
}

function persistCanonicalSession(session: OperatorSession): void {
  writeScoped(SESSION_KEY, JSON.stringify({
    ...session,
    user: minimalOperatorIdentity(session.user),
  }));
}

/** Mantém bearer e identidade operacional somente durante a sessão da aba. */
export function saveOperatorSession(token: string, user: any): void {
  const minimalUser = minimalOperatorIdentity(user);
  const session: OperatorSession = {
    token,
    user: minimalUser,
    expiresAt: Date.now() + TWENTY_FOUR_HOURS_MS,
  };
  persistCanonicalSession(session);
  writeScoped('koma_caixa_token', token);
  removeEverywhere('token');
  if (minimalUser.id != null) writeScoped('koma_caixa_id', String(minimalUser.id));
  if (minimalUser.nome) writeScoped('koma_caixa_name', minimalUser.nome);
  if (minimalUser.role) writeScoped('koma_caixa_role', minimalUser.role);
}

/** Compatibilidade do portal Garçom enquanto o shell ainda usa aliases escopados. */
export function saveWaiterSession(token: string, user: any): void {
  const minimalUser = minimalOperatorIdentity(user);
  writeScoped('koma_waiter_token', token);
  if (minimalUser.id != null) writeScoped('koma_waiter_id', String(minimalUser.id));
  if (minimalUser.nome) writeScoped('koma_waiter_name', minimalUser.nome);
  writeScoped('koma_user_role', minimalUser.role || 'garcom');
  removeEverywhere('token');
}

export function getOperatorSession(): OperatorSession | null {
  removeEverywhere('token');
  const rawSession = readScopedWithLegacyMigration(SESSION_KEY);
  if (!rawSession) {
    const legacyToken = readScopedWithLegacyMigration('koma_caixa_token');
    if (!legacyToken) return null;
    const legacySession: OperatorSession = {
      token: legacyToken,
      user: {
        id: readScopedWithLegacyMigration('koma_caixa_id') || undefined,
        nome: readScopedWithLegacyMigration('koma_caixa_name') || undefined,
        role: readScopedWithLegacyMigration('koma_caixa_role') || 'operador',
      },
      expiresAt: Date.now() + TWENTY_FOUR_HOURS_MS,
    };
    persistCanonicalSession(legacySession);
    return legacySession;
  }

  try {
    const parsed = JSON.parse(rawSession) as OperatorSession;
    if (Date.now() > Number(parsed.expiresAt)) {
      clearOperatorSession();
      return null;
    }

    const session: OperatorSession = {
      token: String(parsed.token || ''),
      user: minimalOperatorIdentity(parsed.user),
      expiresAt: Number(parsed.expiresAt),
    };
    if (!session.token || !Number.isFinite(session.expiresAt)) {
      clearOperatorSession();
      return null;
    }

    // Migração one-way também remove PII eventualmente presente no snapshot legado.
    persistCanonicalSession(session);
    return session;
  } catch {
    clearOperatorSession();
    return null;
  }
}

export function getOperationalAccessToken(portal: OperationalPortal): string {
  if (portal === 'garcom') {
    return readScopedWithLegacyMigration('koma_waiter_token') || '';
  }
  return getOperatorSession()?.token || readScopedWithLegacyMigration('koma_caixa_token') || '';
}

export function getOperatorAccessToken(): string {
  return getOperatorSession()?.token || readScopedWithLegacyMigration('koma_waiter_token') || '';
}

export function clearWaiterSession(): void {
  WAITER_KEYS.forEach(removeEverywhere);
  removeEverywhere('token');
}

export function clearOperatorSession(): void {
  removeEverywhere(SESSION_KEY);
  CAIXA_KEYS.forEach(removeEverywhere);
  removeEverywhere('token');
}
