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

const SMARTPOS_SESSION_KEY = 'koma_smartpos_session';
const SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export function saveSmartPosSession(token: string, user: SmartPosUser): SmartPosSession {
  const session: SmartPosSession = {
    token,
    user,
    expiresAt: Date.now() + SESSION_MAX_AGE_MS,
  };

  localStorage.setItem(SMARTPOS_SESSION_KEY, JSON.stringify(session));
  return session;
}

export function getSmartPosSession(): SmartPosSession | null {
  const raw = localStorage.getItem(SMARTPOS_SESSION_KEY);
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

    return session;
  } catch {
    clearSmartPosSession();
    return null;
  }
}

export function clearSmartPosSession(): void {
  localStorage.removeItem(SMARTPOS_SESSION_KEY);
}
