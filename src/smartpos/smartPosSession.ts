export type SmartPosRole = 'garcom' | 'caixa' | 'gerente';

export interface SmartPosUser {
  id: string;
  nome: string;
  role: SmartPosRole;
  restaurante_id: number;
}

export interface SmartPosSession {
  token: string;
  user: SmartPosUser;
  expiresAt: number;
}

export const SMARTPOS_SESSION_KEY = 'koma_smartpos_session';
const SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000;

function getSessionStorage(): Storage | null {
  return typeof sessionStorage !== 'undefined' ? sessionStorage : null;
}

function getLegacyStorage(): Storage | null {
  return typeof localStorage !== 'undefined' ? localStorage : null;
}

function persistSession(session: SmartPosSession): void {
  const scoped = getSessionStorage();
  const durable = getLegacyStorage();
  scoped?.setItem(SMARTPOS_SESSION_KEY, JSON.stringify(session));
  durable?.removeItem(SMARTPOS_SESSION_KEY);
}

export function saveSmartPosSession(token: string, user: SmartPosUser): SmartPosSession {
  const session: SmartPosSession = {
    token,
    user,
    expiresAt: Date.now() + SESSION_MAX_AGE_MS,
  };

  persistSession(session);
  return session;
}

export function getSmartPosSession(): SmartPosSession | null {
  const scoped = getSessionStorage();
  const durable = getLegacyStorage();
  const scopedRaw = scoped?.getItem(SMARTPOS_SESSION_KEY) || null;
  const legacyRaw = durable?.getItem(SMARTPOS_SESSION_KEY) || null;
  const raw = scopedRaw || legacyRaw;
  if (!raw) return null;

  try {
    const session = JSON.parse(raw) as SmartPosSession;
    if (
      !session?.token
      || !session?.user?.id
      || !session?.user?.nome
      || !session?.user?.role
      || !Number.isInteger(session?.user?.restaurante_id)
      || session.user.restaurante_id <= 0
      || Date.now() >= session.expiresAt
    ) {
      clearSmartPosSession();
      return null;
    }

    // Migração one-way: versões antigas persistiam o bearer em localStorage.
    if (!scopedRaw || legacyRaw) persistSession(session);
    return session;
  } catch {
    clearSmartPosSession();
    return null;
  }
}

export function clearSmartPosSession(): void {
  getSessionStorage()?.removeItem(SMARTPOS_SESSION_KEY);
  getLegacyStorage()?.removeItem(SMARTPOS_SESSION_KEY);
}
