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

export type OperationalPortal = 'caixa' | 'garcom';

const SESSION_KEY = 'koma_operator_session';
const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;
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
  if (Number.isInteger(user?.restaurante_id) && user.restaurante_id > 0) {
    snapshot.restaurante_id = Number(user.restaurante_id);
  }
  return snapshot;
}

function identityPortal(user: OperatorIdentitySnapshot): OperationalPortal | null {
  const role = String(user.role || user.cargo || '').trim().toLowerCase();
  if (role === 'garcom') return 'garcom';
  if (role === 'admin' || role === 'gerente' || role === 'caixa') return 'caixa';
  return null;
}

function clearKeys(keys: readonly string[]): void {
  for (const key of keys) localStorage.removeItem(key);
}

function scopedAliasToken(portal: OperationalPortal): string {
  return portal === 'garcom'
    ? localStorage.getItem('koma_waiter_token') || ''
    : localStorage.getItem('koma_caixa_token') || '';
}

function persistCanonicalSession(session: OperatorSession): void {
  localStorage.setItem(SESSION_KEY, JSON.stringify({
    ...session,
    user: minimalOperatorIdentity(session.user),
  }));
}

function persistScopedAliases(token: string, user: OperatorIdentitySnapshot): void {
  const portal = identityPortal(user);
  if (portal === 'garcom') {
    clearKeys(CAIXA_ALIAS_KEYS);
    localStorage.setItem('koma_waiter_token', token);
    if (user.id != null) localStorage.setItem('koma_waiter_id', String(user.id));
    if (user.nome) localStorage.setItem('koma_waiter_name', user.nome);
    localStorage.setItem('koma_user_role', String(user.role || user.cargo || 'garcom'));
    return;
  }

  clearKeys(WAITER_ALIAS_KEYS);
  localStorage.setItem('koma_caixa_token', token);
  // O app operacional e o WebSocket ainda compartilham estas chaves legadas.
  // Elas serão retiradas na fase seguinte, junto da migração para sessão HttpOnly.
  if (user.id != null) localStorage.setItem('koma_caixa_id', String(user.id));
  if (user.nome) localStorage.setItem('koma_caixa_name', user.nome);
  if (user.role || user.cargo) {
    localStorage.setItem('koma_caixa_role', String(user.role || user.cargo));
  }
}

// Salva a sessão operacional canônica com 24 horas de validade. O papel
// autenticado decide quais aliases legados permanecem ativos: nunca deixamos
// credenciais simultâneas de Caixa e Garçom disputarem a mesma URL.
export function saveOperatorSession(token: string, user: any): void {
  const minimalUser = minimalOperatorIdentity(user);
  const session: OperatorSession = {
    token,
    user: minimalUser,
    expiresAt: Date.now() + TWENTY_FOUR_HOURS_MS,
  };
  persistCanonicalSession(session);
  localStorage.removeItem('token');
  persistScopedAliases(token, minimalUser);
}

// Recupera a sessão operacional e limpa automaticamente se tiver mais de 24h.
export function getOperatorSession(): OperatorSession | null {
  // Limpa o alias genérico deixado por versões antigas assim que o app inicia.
  localStorage.removeItem('token');
  const rawSession = localStorage.getItem(SESSION_KEY);
  if (!rawSession) {
    // Fallback temporário somente para a chave escopada do Caixa. Tokens antigos
    // do portal de Garçom não podem escolher sozinhos a entrada canônica da equipe.
    const legacyToken = localStorage.getItem('koma_caixa_token');
    if (legacyToken) {
      const legacySession: OperatorSession = {
        token: legacyToken,
        user: { role: localStorage.getItem('koma_caixa_role') || 'operador' },
        expiresAt: Date.now() + TWENTY_FOUR_HOURS_MS,
      };
      saveOperatorSession(legacyToken, legacySession.user);
      return legacySession;
    }
    return null;
  }

  try {
    const parsed = JSON.parse(rawSession) as OperatorSession;

    if (Date.now() > parsed.expiresAt) {
      console.warn("⚠️ Sessão de operador expirada (mais de 24h). Efetuando logout...");
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

    // Migração one-way: versões antigas persistiam o objeto completo de usuário.
    // Reescrevemos a sessão canônica para remover PII. Só reparamos aliases quando
    // o mesmo token está comprovadamente no portal errado; ausência de alias é
    // sinal de logout e nunca pode recriar credenciais.
    persistCanonicalSession(session);
    const portal = identityPortal(session.user);
    const misplacedAliasToken = portal === 'garcom'
      ? localStorage.getItem('koma_caixa_token') || ''
      : portal === 'caixa'
        ? localStorage.getItem('koma_waiter_token') || ''
        : '';
    if (misplacedAliasToken === session.token) {
      persistScopedAliases(session.token, session.user);
    }
    return session;
  } catch (e) {
    clearOperatorSession();
    return null;
  }
}

export function getPersistedOperationalPortal(): OperationalPortal | null {
  const session = getOperatorSession();
  if (!session?.token) return null;

  const portal = identityPortal(session.user);
  if (portal && scopedAliasToken(portal) === session.token) return portal;

  // Compatibilidade para sessões antigas do Caixa que não persistiam cargo/role.
  if (localStorage.getItem('koma_caixa_token') === session.token) return 'caixa';
  return null;
}

export function getOperationalAccessToken(portal: OperationalPortal): string {
  const aliasToken = scopedAliasToken(portal);
  if (!aliasToken) return '';

  const session = getOperatorSession();
  if (session?.token && identityPortal(session.user) === portal) {
    return session.token === aliasToken ? session.token : '';
  }

  // Compatibilidade temporária com sessões legadas que ainda só possuem o alias.
  return aliasToken;
}

export function getOperatorAccessToken(): string {
  const waiterToken = scopedAliasToken('garcom');
  const caixaToken = scopedAliasToken('caixa');
  const session = getOperatorSession();

  if (session?.token) {
    const portal = identityPortal(session.user);
    if (portal === 'garcom') return waiterToken === session.token ? session.token : '';
    if (portal === 'caixa') return caixaToken === session.token ? session.token : '';
  }

  return waiterToken || caixaToken || '';
}

// Limpa toda a autenticação operacional no logout ou expiração, preservando
// preferências e dados locais que não representam identidade/credenciais.
export function clearOperatorSession(): void {
  clearKeys([
    SESSION_KEY,
    'token',
    ...CAIXA_ALIAS_KEYS,
    ...WAITER_ALIAS_KEYS,
  ]);
}
