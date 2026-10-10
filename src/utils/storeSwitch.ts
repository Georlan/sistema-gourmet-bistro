import { authFetch } from './authRequest';
import { getOperatorSession, saveOperatorSession } from './authSession';
import type { OperatorIdentitySnapshot } from './authSession';

export interface StoreOption { id: number; nome: string }
export interface StoreIndex {
  current: StoreOption;
  network: { id: string; nome: string } | null;
  units: StoreOption[];
}
export interface StoreSwitchSession {
  token: string;
  user: OperatorIdentitySnapshot & { id: string; nome: string; restaurante_id: number };
}
const MANAGEMENT_ROLES = new Set(['admin', 'gerente']);
export function canSwitchStore(role: unknown): boolean {
  return MANAGEMENT_ROLES.has(String(role || '').trim().toLowerCase());
}

async function storeResponse(response: Response): Promise<any> {
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(typeof data?.detail === 'string' ? data.detail : 'Não foi possível consultar as unidades autorizadas.');
  return data;
}

export async function getStoreIndex(apiBase: string, token: string, signal?: AbortSignal): Promise<StoreIndex> {
  const data = await storeResponse(await authFetch(`${apiBase}/auth/lojas`, { headers: { Authorization: `Bearer ${token}` }, signal }));
  const validStore = (store: any) => Number.isInteger(store?.id) && store.id > 0 && typeof store.nome === 'string' && store.nome.trim();
  if (!validStore(data?.current) || !Array.isArray(data?.units) || !data.units.every(validStore)
    || (data.network !== null && (typeof data.network?.id !== 'string' || !data.network.id || typeof data.network?.nome !== 'string'))
    || (!data.network && data.units.length)) {
    throw new Error('A lista de unidades está incompleta. Tente novamente.');
  }
  return data;
}

export async function requestStoreSwitch(apiBase: string, token: string, targetId: number, signal?: AbortSignal): Promise<StoreSwitchSession> {
  if (!Number.isInteger(targetId) || targetId <= 0) throw new Error('Unidade inválida.');
  const data = await storeResponse(await authFetch(`${apiBase}/auth/lojas/${targetId}/entrar`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, signal }));
  const user = data?.usuario;
  if (typeof data?.access_token !== 'string' || !data.access_token || typeof user?.id !== 'string' || !user.id
    || typeof user?.nome !== 'string' || !user.nome.trim() || user?.restaurante_id !== targetId
    || !canSwitchStore(user.role || user.cargo)) {
    throw new Error('O acesso recebido não corresponde à unidade selecionada.');
  }
  const role = String(user.role || user.cargo).trim().toLowerCase();
  return { token: data.access_token, user: { id: user.id, nome: user.nome, role, cargo: role, restaurante_id: targetId } };
}

/** Commit only after confirmation; an expired/replaced source session cannot be overwritten. */
export function commitStoreSwitch(next: StoreSwitchSession, expectedToken: string): void {
  const previous = getOperatorSession('caixa');
  if (sessionStorage.getItem('koma_support_session') || String(previous?.user.id).startsWith('support:')) {
    throw new Error('A troca de loja não está disponível durante uma sessão de suporte.');
  }
  if (!previous || previous.token !== expectedToken || !canSwitchStore(previous.user.role || previous.user.cargo)) {
    throw new Error('Sua sessão mudou. Feche esta janela e entre novamente.');
  }
  if (!next.token || !next.user.id || !next.user.nome?.trim()
    || !Number.isInteger(next.user.restaurante_id) || next.user.restaurante_id <= 0
    || !canSwitchStore(next.user.role || next.user.cargo)) {
    throw new Error('O acesso à loja de destino é inválido.');
  }
  if (previous.user.restaurante_id === next.user.restaurante_id) {
    throw new Error('Você já está nesta loja.');
  }
  saveOperatorSession(next.token, next.user, 'caixa');
  // Navigation and onboarding drafts are specific to the previous unit, too.
  for (const key of ['koma_active_tab', 'koma_active_subtab', 'koma_onboarding_test_order']) {
    sessionStorage.removeItem(key);
  }
}
