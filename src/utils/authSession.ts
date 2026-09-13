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

const LEGACY_SESSION_KEY = 'koma_operator_session';
const SESSION_KEY_BY_PORTAL: Record<OperationalPortal, string> = {
  caixa: 'koma_operator_session_caixa',
  garcom: 'koma_operator_session_garcom',
};
const ACTIVE_PORTAL_KEY = 'koma_active_operational_portal';
const LAST_PORTAL_KEY = 'koma_last_operational_portal';
const LOGGED_OUT_TAB_KEY = 'koma_operational_logged_out';
const FALLBACK_SESSION_MS = 30 * 24 * 60 * 60 * 1000;
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

function isOperationalPortal(value: string | null): value is OperationalPortal {
  return value === 'caixa' || value === 'garcom';
}

function getTabStorage(): Storage | null {
  return typeof sessionStorage === 'undefined' ? null : sessionStorage;
}

function clearKeys(storage: Storage, keys: readonly string[]): void {
  for (const key of keys) storage.removeItem(key);
}

function portalAliasKeys(portal: OperationalPortal): readonly string[] {
  return portal === 'garcom' ? WAITER_ALIAS_KEYS : CAIXA_ALIAS_KEYS;
}

function getTabPortal(): OperationalPortal | null {
  const value = getTabStorage()?.getItem(ACTIVE_PORTAL_KEY) || null;
  return isOperationalPortal(value) ? value : null;
}

function getLastPortal(): OperationalPortal | null {
  const value = localStorage.getItem(LAST_PORTAL_KEY);
  return isOperationalPortal(value) ? value : null;
}

function setTabPortal(portal: OperationalPortal): void {
  const storage = getTabStorage();
  storage?.setItem(ACTIVE_PORTAL_KEY, portal);
  storage?.removeItem(LOGGED_OUT_TAB_KEY);
  localStorage.setItem(LAST_PORTAL_KEY, portal);
}

function scopedAliasToken(portal: OperationalPortal): string {
  return portal === 'garcom'
    ? localStorage.getItem('koma_waiter_token') || ''
    : localStorage.getItem('koma_caixa_token') || '';
}

function readJwtExpiryMs(token: string): number | null {
  try {
    const payloadPart = token.split('.')[1];
    if (!payloadPart || typeof atob !== 'function') return null;
    const normalized = payloadPart.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    const payload = JSON.parse(atob(padded));
    const expSeconds = Number(payload?.exp);
    if (!Number.isFinite(expSeconds) || expSeconds <= 0) return null;
    return expSeconds * 1000;
  } catch {
    return null;
  }
}

function parseStoredSession(rawSession: string | null): OperatorSession | null {
  if (!rawSession) return null;
  try {
    const parsed = JSON.parse(rawSession) as OperatorSession;
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
}

function persistedSessionPortal(rawSession: string | null): OperationalPortal | null {
  const parsed = parseStoredSession(rawSession);
  return parsed ? identityPortal(parsed.user || {}) : null;
}

function persistCanonicalSession(portal: OperationalPortal, session: OperatorSession): void {
  localStorage.setItem(SESSION_KEY_BY_PORTAL[portal], JSON.stringify({
    ...session,
    user: minimalOperatorIdentity(session.user),
  }));
}

function persistScopedAliases(token: string, user: OperatorIdentitySnapshot): void {
  const portal = identityPortal(user);
  if (!portal) return;

  // Os aliases ainda existem porque o App legado os lê diretamente. Cada portal
  // limpa apenas o próprio namespace: entrar como Caixa não apaga o Garçom ativo
  // em outra aba, e vice-versa.
  clearKeys(localStorage, portalAliasKeys(portal));

  if (portal === 'garcom') {
    localStorage.setItem('koma_waiter_token', token);
    if (user.id != null) localStorage.setItem('koma_waiter_id', String(user.id));
    if (user.nome) localStorage.setItem('koma_waiter_name', user.nome);
    localStorage.setItem('koma_user_role', String(user.role || user.cargo || 'garcom'));
    return;
  }

  localStorage.setItem('koma_caixa_token', token);
  if (user.id != null) localStorage.setItem('koma_caixa_id', String(user.id));
  if (user.nome) localStorage.setItem('koma_caixa_name', user.nome);
  if (user.role || user.cargo) {
    localStorage.setItem('koma_caixa_role', String(user.role || user.cargo));
  }
}

function legacyAliasSession(portal: OperationalPortal): OperatorSession | null {
  const token = scopedAliasToken(portal);
  if (!token) return null;

  if (portal === 'garcom') {
    // Alias antigo isolado de Garçom não escolhe sozinho uma aba nova. Ele só é
    // aceito quando a própria aba já está vinculada ao portal do Garçom.
    if (getTabPortal() !== 'garcom') return null;
    return {
      token,
      user: {
        id: localStorage.getItem('koma_waiter_id') || undefined,
        nome: localStorage.getItem('koma_waiter_name') || undefined,
        role: localStorage.getItem('koma_user_role') || 'garcom',
      },
      expiresAt: readJwtExpiryMs(token) ?? (Date.now() + FALLBACK_SESSION_MS),
    };
  }

  return {
    token,
    user: {
      id: localStorage.getItem('koma_caixa_id') || undefined,
      nome: localStorage.getItem('koma_caixa_name') || undefined,
      role: localStorage.getItem('koma_caixa_role') || 'operador',
    },
    expiresAt: readJwtExpiryMs(token) ?? (Date.now() + FALLBACK_SESSION_MS),
  };
}

function readPortalSession(portal: OperationalPortal): OperatorSession | null {
  const scopedRaw = localStorage.getItem(SESSION_KEY_BY_PORTAL[portal]);
  const legacyRaw = localStorage.getItem(LEGACY_SESSION_KEY);
  const legacyMatchesPortal = persistedSessionPortal(legacyRaw) === portal;
  const parsed = parseStoredSession(scopedRaw)
    || (legacyMatchesPortal ? parseStoredSession(legacyRaw) : null)
    || legacyAliasSession(portal);

  if (!parsed) return null;

  const token = String(parsed.token || '');
  const storedExpiry = Number(parsed.expiresAt);
  const tokenExpiry = readJwtExpiryMs(token);
  const expiresAt = tokenExpiry ?? storedExpiry;

  if (!token || !Number.isFinite(expiresAt)) {
    clearOperatorSession(portal);
    return null;
  }

  if (Date.now() > expiresAt) {
    console.warn('⚠️ Sessão de operador expirada. Efetuando logout desta área...');
    clearOperatorSession(portal);
    return null;
  }

  const session: OperatorSession = {
    token,
    user: minimalOperatorIdentity(parsed.user),
    expiresAt,
  };

  // Migração de builds antigos: algumas sessões de Garçom foram gravadas nos
  // aliases do Caixa. Reparamos apenas quando o token é exatamente o mesmo;
  // token diferente no outro portal significa sessão concorrente legítima.
  if (!scopedAliasToken(portal)) {
    const otherPortal: OperationalPortal = portal === 'caixa' ? 'garcom' : 'caixa';
    if (scopedAliasToken(otherPortal) === session.token) {
      clearKeys(localStorage, portalAliasKeys(otherPortal));
      persistScopedAliases(session.token, session.user);
    }
  }

  persistCanonicalSession(portal, session);
  return session;
}

function candidatePortal(): OperationalPortal | null {
  const tabPortal = getTabPortal();
  if (tabPortal) return tabPortal;

  const legacyPortal = persistedSessionPortal(localStorage.getItem(LEGACY_SESSION_KEY));
  if (legacyPortal) return legacyPortal;

  const lastPortal = getLastPortal();
  if (lastPortal && localStorage.getItem(SESSION_KEY_BY_PORTAL[lastPortal])) return lastPortal;

  if (localStorage.getItem(SESSION_KEY_BY_PORTAL.caixa)) return 'caixa';
  if (localStorage.getItem(SESSION_KEY_BY_PORTAL.garcom)) return 'garcom';

  // Compatibilidade com a sessão antiga do Caixa para chamadas internas que ainda
  // chegam aqui fora da entrada unificada.
  if (localStorage.getItem('koma_caixa_token')) return 'caixa';
  return null;
}

// A sessão persistida continua acompanhando o vencimento real do JWT, mas qual
// portal está aberto é decisão da ABA, guardada em sessionStorage. Assim uma aba
// pode ser Garçom e outra Caixa no mesmo navegador sem compartilharem navegação.
export function saveOperatorSession(token: string, user: any): void {
  const minimalUser = minimalOperatorIdentity(user);
  const portal = identityPortal(minimalUser);
  if (!portal) return;

  const session: OperatorSession = {
    token,
    user: minimalUser,
    expiresAt: readJwtExpiryMs(token) ?? (Date.now() + FALLBACK_SESSION_MS),
  };

  persistCanonicalSession(portal, session);
  // A chave única antiga é somente uma ponte de migração. Novos logins não a
  // recriam, porque ela faria uma aba nova escolher automaticamente outro login.
  localStorage.removeItem(LEGACY_SESSION_KEY);
  localStorage.removeItem('token');
  persistScopedAliases(token, minimalUser);
  setTabPortal(portal);
}

export function getOperatorSession(portal?: OperationalPortal): OperatorSession | null {
  localStorage.removeItem('token');
  const selectedPortal = portal || candidatePortal();
  if (!selectedPortal) return null;
  return readPortalSession(selectedPortal);
}

export function getPersistedOperationalPortal(): OperationalPortal | null {
  const tabStorage = getTabStorage();
  if (tabStorage?.getItem(LOGGED_OUT_TAB_KEY)) return null;

  // Regra nova: uma aba já vinculada restaura o próprio portal em reload.
  const tabPortal = getTabPortal();
  if (tabPortal) {
    const session = getOperatorSession(tabPortal);
    if (session?.token && scopedAliasToken(tabPortal) === session.token) return tabPortal;
    return null;
  }

  // Migração one-shot da chave canônica antiga. Depois de migrar a aba atual,
  // removemos a chave compartilhada para que uma NOVA aba abra no login e possa
  // autenticar outro perfil sem precisar derrubar a sessão existente.
  const legacyRaw = localStorage.getItem(LEGACY_SESSION_KEY);
  const legacyPortal = persistedSessionPortal(legacyRaw);
  if (!legacyPortal) return null;

  const session = getOperatorSession(legacyPortal);
  if (session?.token && scopedAliasToken(legacyPortal) === session.token) {
    setTabPortal(legacyPortal);
    localStorage.removeItem(LEGACY_SESSION_KEY);
    return legacyPortal;
  }

  return null;
}

export function getOperationalAccessToken(portal: OperationalPortal): string {
  const aliasToken = scopedAliasToken(portal);
  if (!aliasToken) return '';

  const session = getOperatorSession(portal);
  if (session?.token) return session.token === aliasToken ? session.token : '';

  // Compatibilidade temporária com sessão antiga de Caixa somente por alias.
  return portal === 'caixa' ? aliasToken : '';
}

export function getOperatorAccessToken(): string {
  const portal = getTabPortal() || getPersistedOperationalPortal();
  if (portal) return getOperationalAccessToken(portal);
  return '';
}

// O logout padrão limpa somente a área ligada à aba atual. Sem contexto de aba
// (rotinas de migração/teste), preservamos a limpeza global antiga.
export function clearOperatorSession(portal?: OperationalPortal): void {
  const selectedPortal = portal || getTabPortal();
  const tabStorage = getTabStorage();

  if (selectedPortal) {
    clearKeys(localStorage, [SESSION_KEY_BY_PORTAL[selectedPortal], ...portalAliasKeys(selectedPortal)]);

    const legacyPortal = persistedSessionPortal(localStorage.getItem(LEGACY_SESSION_KEY));
    if (legacyPortal === selectedPortal) localStorage.removeItem(LEGACY_SESSION_KEY);

    if (getLastPortal() === selectedPortal) {
      const alternate: OperationalPortal = selectedPortal === 'caixa' ? 'garcom' : 'caixa';
      if (
        localStorage.getItem(SESSION_KEY_BY_PORTAL[alternate])
        && scopedAliasToken(alternate)
      ) {
        localStorage.setItem(LAST_PORTAL_KEY, alternate);
      } else {
        localStorage.removeItem(LAST_PORTAL_KEY);
      }
    }
  } else {
    clearKeys(localStorage, [
      LEGACY_SESSION_KEY,
      SESSION_KEY_BY_PORTAL.caixa,
      SESSION_KEY_BY_PORTAL.garcom,
      LAST_PORTAL_KEY,
      'token',
      ...CAIXA_ALIAS_KEYS,
      ...WAITER_ALIAS_KEYS,
    ]);
  }

  tabStorage?.removeItem(ACTIVE_PORTAL_KEY);
  tabStorage?.setItem(LOGGED_OUT_TAB_KEY, '1');
}
