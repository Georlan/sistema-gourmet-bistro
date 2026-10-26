import { authFetchJson } from './authRequest';

export const COURIER_ACCESS_KEY = 'koma_entregador_session_token';

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

export function persistCourierAccess(token: string): void {
  try { sessionStorage.setItem(COURIER_ACCESS_KEY, token); }
  catch { throw new Error('Não foi possível guardar o acesso nesta aba. Permita o armazenamento do site e tente novamente.'); }
}

export function clearCourierAccess(): void {
  try { sessionStorage.removeItem(COURIER_ACCESS_KEY); } catch { /* Blocked storage is not used as a fallback. */ }
}
