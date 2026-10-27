import { authFetchJson } from './authRequest';

export const COURIER_ACCESS_KEY = 'koma_entregador_session_token';
export const COURIER_ACCESS_META_KEY = 'koma_entregador_session_meta_v1';

export type CourierAccessRecoveryReason =
  | 'missing'
  | 'expired'
  | 'revoked'
  | 'replaced'
  | 'session_lost';

export interface CourierAccessMeta {
  expiresAt: number | null;
  source: 'login' | 'link';
  savedAt: number;
}

export interface CourierAccessState {
  token: string;
  reason: CourierAccessRecoveryReason | null;
  expiresAt: number | null;
}

export function readCourierTokenExpiryMs(token: string): number | null {
  try {
    const payloadPart = token.split('.')[1];
    if (!payloadPart || typeof atob !== 'function') return null;
    const normalized = payloadPart.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    const expSeconds = Number(JSON.parse(atob(padded))?.exp);
    return Number.isFinite(expSeconds) && expSeconds > 0 ? expSeconds * 1000 : null;
  } catch {
    return null;
  }
}

export function isCourierTokenExpired(token: string, now = Date.now()): boolean {
  const expiresAt = readCourierTokenExpiryMs(token);
  return expiresAt !== null && now >= expiresAt;
}

/** The staff JWT exists only for this exchange; the app retains the narrower token. */
export async function requestCourierAccess(apiBase: string, staffToken: string, signal: AbortSignal): Promise<string> {
  const { response, data: payload } = await authFetchJson(`${apiBase}/comandas/motoboys/me/acesso`, {
    method: 'POST', headers: { Authorization: `Bearer ${staffToken}` }, signal,
  });
  const data = payload as { token?: unknown; detail?: unknown } | null;
  if (!response.ok) throw new Error(typeof data?.detail === 'string' ? data.detail : 'Não foi possível abrir suas entregas.');
  if (typeof data?.token !== 'string' || !data.token.trim()) throw new Error('A resposta de acesso às entregas está incompleta.');
  return data.token;
}

export function persistCourierAccess(token: string, source: 'login' | 'link' = 'login'): void {
  const clean = token.trim();
  const meta: CourierAccessMeta = {
    expiresAt: readCourierTokenExpiryMs(clean),
    source,
    savedAt: Date.now(),
  };
  try {
    sessionStorage.setItem(COURIER_ACCESS_KEY, clean);
    sessionStorage.setItem(COURIER_ACCESS_META_KEY, JSON.stringify(meta));
    sessionStorage.removeItem('koma_entregador_copied_discarded_v1');
  } catch {
    throw new Error('Não foi possível guardar o acesso nesta aba. Permita o armazenamento do site e tente novamente.');
  }
}

export function clearCourierAccess(): void {
  for (const key of [COURIER_ACCESS_KEY, COURIER_ACCESS_META_KEY, 'koma_entregador_copied_discarded_v1']) {
    try { sessionStorage.removeItem(key); } catch { /* Blocked storage is not used as a fallback. */ }
  }
}

export function readCourierAccessMeta(): CourierAccessMeta | null {
  try {
    const raw = sessionStorage.getItem(COURIER_ACCESS_META_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CourierAccessMeta> | null;
    if (!parsed || typeof parsed !== 'object') return null;
    const expiresAt = typeof parsed.expiresAt === 'number' && Number.isFinite(parsed.expiresAt) ? parsed.expiresAt : null;
    const source = parsed.source === 'link' ? 'link' : 'login';
    const savedAt = typeof parsed.savedAt === 'number' && Number.isFinite(parsed.savedAt) ? parsed.savedAt : 0;
    return { expiresAt, source, savedAt };
  } catch {
    return null;
  }
}

export function classifyCourierAuthError(detail: unknown, token?: string): 'expired' | 'revoked' {
  if (token && isCourierTokenExpired(token)) return 'expired';
  const text = typeof detail === 'string' ? detail.toLowerCase() : '';
  if (text.includes('expirou') || text.includes('expirad')) return 'expired';
  return 'revoked';
}

export function describeCourierRecoveryReason(reason: CourierAccessRecoveryReason): {
  title: string;
  message: string;
  canSignIn: boolean;
} {
  switch (reason) {
    case 'expired':
      return {
        title: 'Sessão de entregas expirada',
        message: 'Seu acesso de 4 horas terminou. Entre novamente com seu e-mail e senha ou solicite um novo link ao Caixa.',
        canSignIn: true,
      };
    case 'revoked':
      return {
        title: 'Acesso encerrado',
        message: 'Este acesso foi encerrado ou atualizado pelo Caixa. Entre novamente ou abra o link mais recente enviado pelo Caixa.',
        canSignIn: true,
      };
    case 'replaced':
      return {
        title: 'Aba sem sessão ativa',
        message: 'Esta aba foi duplicada de outro acesso. Entre com sua conta de entregador nesta aba ou volte para a aba original.',
        canSignIn: true,
      };
    case 'session_lost':
      return {
        title: 'Retome seu acesso às entregas',
        message: 'O navegador encerrou a sessão local após longo período em segundo plano. Entre novamente para abrir suas entregas.',
        canSignIn: true,
      };
    case 'missing':
    default:
      return {
        title: 'Seu acesso às entregas',
        message: 'Abra o link de acesso enviado pelo caixa ou entre com sua conta de entregador.',
        canSignIn: true,
      };
  }
}

