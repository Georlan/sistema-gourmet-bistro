/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface OperatorSession {
  token: string;
  user: any;
  expiresAt: number; // Timestamp de expiração em milissegundos
}

const SESSION_KEY = 'koma_operator_session';
const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

// Salva a sessão do operador com 24 horas de validade
export function saveOperatorSession(token: string, user: any): void {
  const session: OperatorSession = {
    token,
    user,
    expiresAt: Date.now() + TWENTY_FOUR_HOURS_MS,
  };
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  localStorage.setItem('koma_caixa_token', token);
  localStorage.setItem('token', token);
  // O app operacional e o WebSocket compartilham estas chaves legadas.
  // Mantê-las sincronizadas evita uma sessão HTTP válida sem identidade para
  // o canal em tempo real após login, ativação do caixa ou atualização.
  if (user?.id != null) {
    localStorage.setItem('koma_caixa_id', String(user.id));
  }
  if (user?.nome) {
    localStorage.setItem('koma_caixa_name', String(user.nome));
  }
  if (user?.role) {
    localStorage.setItem('koma_caixa_role', String(user.role));
  }
}

// Recupera a sessão do operador e limpa automaticamente se tiver mais de 24h
export function getOperatorSession(): OperatorSession | null {
  const rawSession = localStorage.getItem(SESSION_KEY);
  if (!rawSession) {
    // Fallback para tokens legados sem expiração
    const legacyToken = localStorage.getItem('koma_caixa_token') || localStorage.getItem('token');
    if (legacyToken) {
      const legacySession: OperatorSession = {
        token: legacyToken,
        user: { role: localStorage.getItem('koma_caixa_role') || 'operador' },
        expiresAt: Date.now() + TWENTY_FOUR_HOURS_MS
      };
      saveOperatorSession(legacyToken, legacySession.user);
      return legacySession;
    }
    return null;
  }

  try {
    const session: OperatorSession = JSON.parse(rawSession);
    
    // Verifica se a sessão expirou
    if (Date.now() > session.expiresAt) {
      console.warn("⚠️ Sessão de operador expirada (mais de 24h). Efetuando logout...");
      clearOperatorSession();
      return null;
    }

    return session;
  } catch (e) {
    clearOperatorSession();
    return null;
  }
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
