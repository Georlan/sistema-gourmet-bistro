import { authFetch } from './authRequest';
import { getOperatorSession, saveOperatorSession } from './authSession';
import type { OperatorIdentitySnapshot } from './authSession';

export interface StoreOption { id: number; nome: string }
export interface StoreSwitchSession {
  token: string;
  user: OperatorIdentitySnapshot & { id: string; nome: string; restaurante_id: number };
}
export type StoreSwitchResult =
  | { kind: 'selection'; stores: StoreOption[] }
  | { kind: 'authenticated'; session: StoreSwitchSession };

const MANAGEMENT_ROLES = new Set(['admin', 'gerente']);
export function canSwitchStore(role: unknown): boolean {
  return MANAGEMENT_ROLES.has(String(role || '').trim().toLowerCase());
}

/** Reauthenticate with the existing login contract; never infer access from an email. */
export async function authenticateStoreSwitch(
  loginUrl: string,
  credentials: { username: string; password: string; restaurantId?: number },
  signal?: AbortSignal,
): Promise<StoreSwitchResult> {
  const response = await authFetch(loginUrl, {
    method: 'POST', signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: credentials.username.trim().toLowerCase(),
      password: credentials.password,
      ...(credentials.restaurantId ? { restaurante_id: credentials.restaurantId } : {}),
    }),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = data?.detail;
    if (response.status === 409 && detail?.code === 'restaurant_selection_required') {
      const stores: StoreOption[] = Array.isArray(detail.restaurantes)
        ? detail.restaurantes.filter((store: StoreOption) => Number.isInteger(store?.id) && store.id > 0)
          .map((store: StoreOption) => ({ id: store.id, nome: String(store.nome || `Loja ${store.id}`) }))
        : [];
      if (stores.length) return { kind: 'selection', stores };
    }
    throw new Error(typeof detail === 'string' ? detail : detail?.message || 'Não foi possível confirmar o acesso à loja.');
  }
  const user = data?.usuario;
  if (!data?.access_token || typeof data.access_token !== 'string'
    || typeof user?.id !== 'string' || !user.id || typeof user?.nome !== 'string' || !user.nome.trim()
    || !Number.isInteger(user?.restaurante_id) || user.restaurante_id <= 0) {
    throw new Error('A resposta de autenticação está incompleta. Tente novamente.');
  }
  const role = String(user.role || user.cargo || '').trim().toLowerCase();
  if (!canSwitchStore(role)) throw new Error('Use uma conta de administrador ou gerente da loja de destino.');
  if (credentials.restaurantId && credentials.restaurantId !== user.restaurante_id) {
    throw new Error('O acesso recebido não corresponde à loja selecionada.');
  }
  // Keep only the identity needed to replace the operational session. No credentials or PII.
  return { kind: 'authenticated', session: {
    token: data.access_token,
    user: { id: user.id, nome: user.nome, role, cargo: role, restaurante_id: user.restaurante_id },
  } };
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
