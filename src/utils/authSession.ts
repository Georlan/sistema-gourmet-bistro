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

function persistCanonicalSession(session: OperatorSession): void {
  localStorage.setItem(SESSION_KEY, JSON.stringify({
    ...session,
    user: minimalOperatorIdentity(session.user),
  }));
}

// Salva a sessão do operador com 24 horas de validade.
// A chave genérica `token` foi aposentada: ela duplicava o bearer token sem
// escopo e podia ser lida por fluxos que não sabiam a qual portal pertencia.
// O snapshot persistido também é deliberadamente mínimo: e-mail, telefone,
// endereço e outros dados de perfil não são necessários para restaurar o shell.
export function saveOperatorSession(token: string, user: any): void {
  const minimalUser = minimalOperatorIdentity(user);
  const session: OperatorSession = {
    token,
    user: minimalUser,
    expiresAt: Date.now() + TWENTY_FOUR_HOURS_MS,
  };
  persistCanonicalSession(session);
  localStorage.setItem('koma_caixa_token', token);
  localStorage.removeItem('token');
  // O app operacional e o WebSocket ainda compartilham estas chaves legadas.
  // Elas serão retiradas na fase seguinte, junto da migração para sessão HttpOnly.
  if (minimalUser.id != null) {
    localStorage.setItem('koma_caixa_id', String(minimalUser.id));
  }
  if (minimalUser.nome) {
    localStorage.setItem('koma_caixa_name', minimalUser.nome);
  }
  if (minimalUser.role) {
    localStorage.setItem('koma_caixa_role', minimalUser.role);
  }
}

// Recupera a sessão do operador e limpa automaticamente se tiver mais de 24h.
export function getOperatorSession(): OperatorSession | null {
  // Limpa o alias genérico deixado por versões antigas assim que o app inicia.
  localStorage.removeItem('token');
  const rawSession = localStorage.getItem(SESSION_KEY);
  if (!rawSession) {
    // Fallback temporário somente para a chave escopada do Caixa.
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
    // Reescrever no primeiro acesso remove PII que não é necessária ao shell.
    persistCanonicalSession(session);
    return session;
  } catch (e) {
    clearOperatorSession();
    return null;
  }
}

export function getOperationalAccessToken(portal: OperationalPortal): string {
  if (portal === 'garcom') {
    return localStorage.getItem('koma_waiter_token') || '';
  }
  return getOperatorSession()?.token || localStorage.getItem('koma_caixa_token') || '';
}

export function getOperatorAccessToken(): string {
  return getOperatorSession()?.token || localStorage.getItem('koma_waiter_token') || '';
}

// Limpa a sessão no logout ou expiração
export function clearOperatorSession(): void {
  localStorage.removeItem(SESSION_KEY);
  localStorage.removeItem('koma_caixa_token');
  localStorage.removeItem('token');
  localStorage.removeItem('koma_caixa_id');
  localStorage.removeItem('koma_caixa_name');
  localStorage.removeItem('koma_caixa_user_id');
  localStorage.removeItem('koma_caixa_user_name');
  localStorage.removeItem('koma_caixa_role');
}
